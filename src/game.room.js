/* jshint node: true*/
/* jshint esnext: true*/
"use strict";

// Role pseudo-enum
var roles = {
    host: 2,
    mod: 1,
    none: 0,
};

var GameRoom = module.exports = function (name, io, GameObj, logger, externals) {
    this.name = name;
    this.type = "uninitiated";
    this.io = io;
    this.logger = logger;

    this.externals = externals || {};

    // Public data
    // This object will be sent to all connected sockets
    this.data = {
        users: [],

        roomSettings: {
            welcomeMessage: "",
            guestAccess: "full",
            bannedUsersByAuthId: {},
            private: false,
        },
    };

    this.usersByAuthId = {};
    this.socketsByAuthId = {};

    this.repickVotes = [];
    this.kickVotes = {};

    this.timeouts = {};

    this.timeouts.cullVotesInterval = setInterval(this.cullVotes.bind(this), 10000);

    this.gameObj = new GameObj(this);

    // this.data.users[i] and this.usersByAuthId[authId] refer to the same user object
    // looking up users by authId is preferred.
    // Meanwhile this.socketsByAuthId[authId] is a list of
    // all the sockets connected under that authId
};

/* Utility methods */
GameRoom.prototype.info = function (...args) {
    this.logger.info(
        "ROOM " + this.type + "/" + this.name + ":\t" + args[0],
        ...args.slice(1),
    )
};

GameRoom.prototype.debug = function (...args) {
    this.logger.debug(
        "ROOM " + this.type + "/" + this.name + ":\t" + args[0],
        ...args.slice(1),
    )
};

GameRoom.prototype.emit = function (name, event) {
    var args = Array.prototype.slice.apply(arguments);
    var thisArg = this.io.sockets.in(this.type + "/" + this.name);
    thisArg.emit.apply(thisArg, args);
};

GameRoom.prototype.emitToUser = function (authId, name, event) {
    if (this.socketsByAuthId[authId]) {
        var args = Array.prototype.slice.apply(arguments);
        args.shift();
        for (var i = 0; i < this.socketsByAuthId[authId].length; i++) {
            var thisArg = this.socketsByAuthId[authId][i];
            thisArg.emit.apply(thisArg, args);
        }
    }
    else {
        throw new Error("No sockets connected under authId " + authId);
    }
};

GameRoom.prototype.broadcast = function (socket, name, event) {
    var args = Array.prototype.slice.apply(arguments);
    args.shift();

    var thisArg = socket.broadcast.to(this.type + "/" + this.name);
    thisArg.emit.apply(thisArg, args);
};

GameRoom.prototype.disconnectUser = function (authId) {
    if (this.socketsByAuthId[authId]) {
        var sockets = this.socketsByAuthId[authId].slice();
        for (var i = 0; i < sockets.length; i++) {
            sockets[i].disconnect();
        }
    }
    else {
        throw new Error("No sockets connected under authId " + authId);
    }
};

// TODO
// We'll need to adapt this for admin support in the future
GameRoom.prototype.findNextHost = function (startIndex, ignoreIndex) {
    for (var i = startIndex; i < startIndex + this.data.users.length; i++) {
        var j = i % this.data.users.length;

        if (j !== ignoreIndex) {
            var user = this.data.users[j];
            if (user.role !== roles.host) {
                return user;
            }
        }
    }

    return false;
};

GameRoom.prototype.addUser = function (socket) {

    // Join this socket.io room
    socket.join(this.type + "/" + this.name);
    socket.room = this.name;
    socket.roomType = this.type;

    // Reject if in banned list
    if (this.data.roomSettings.bannedUsersByAuthId[socket.authId]) {
        // Send an empty room data
        // Me in the future: is this actually necessary? I can't remember
        socket.emit("roomData", { empty: true });
        socket.emit("disconnectReason", "banned");
        socket.disconnect();
        return;
    }
    // Reject if is guest, guest access is none
    if (this.data.roomSettings.guestAccess === "deny" &&
        socket.authId.indexOf("guest:") === 0) {
        // Send an empty room data
        // Me in the future: is this actually necessary? I can't remember
        socket.emit("roomData", { empty: true });
        socket.emit("disconnectReason", "guestAccess");
        socket.disconnect();
        return;
    }

    var isNewUser = false;

    // If there is already a player with the same authId,
    // just keep track of the socket and don't fire a new addUser event
    if (this.usersByAuthId[socket.authId]) {
        this.socketsByAuthId[socket.authId].push(socket);
        socket.userInstance = this.usersByAuthId[socket.authId];
    }
    else {
        isNewUser = true;

        // Otherwise, make a new user instance
        var newUser = {
            displayName: socket.displayName,
            authId: socket.authId,
            role: roles.none,
            profileImage: socket.profileImage,
        };

        this.data.users.push(newUser);
        this.usersByAuthId[socket.authId] = newUser;
        this.socketsByAuthId[socket.authId] = [socket];
        socket.userInstance = newUser;

        this.info("Player " + socket.displayName +
            " (" + socket.authId + ") has joined.");

        // Broadcast this to the other players in the room
        socket.broadcast.to(this.type + "/" + this.name).emit("addUser", newUser);
    }

    // Set up the socket to this room
    var user = socket.userInstance;
    var room = this;
    // Because of javascript trickiness,
    // most uses of "this" will be replaced with "room"

    // I wish
    // I was coding in a language with proper OOP

    // Send the current room data
    socket.emit("roomData", {
        data: room.data,
        currentServerTime: Date.now(),
    });

    if (isNewUser) {
        // Make this user host if he's the first in the room
        if (this.data.users.length === 1) {
            user.role = roles.host;
            this.emit("setRole", {
                authId: socket.authId,
                role: roles.host,
            });
        }
    }

    // chatMessage listener
    socket.on("chatMessage", function (m) {
        if (typeof m === "string") {
            if (m === "") {
                return;
            }

            if (room.data.roomSettings.guestAccess === "noChat" &&
                user.authId.indexOf("guest:") === 0) {
                return;
            }

            m = m.substring(0, 300);

            // Call a handler on the gameObj if there is one,
            // and allow to prevent default when a true-y value is returned
            if (room.gameObj.onChatMessage) {
                if (room.gameObj.onChatMessage(user, m))
                    return;
            }

            room.emit("chatMessage", {
                authId: user.authId,
                message: m,
            });
        }
    });

    // welcomeMessage listener
    socket.on("welcomeMessage", function (e) {
        if ((user.role == roles.host || user.role === roles.admin) &&
            typeof e === "string") {
            room.data.roomSettings.welcomeMessage = e;
            room.emit("welcomeMessage", e);
        }
    });

    // guestAccess listener
    socket.on("guestAccess", function (e) {
        if (!room.canChange(user)) return;
        if (["full", "noChat", "deny"].indexOf(e) === -1) return;

        if (room.data.roomSettings.guestAccess === e) return;

        room.data.roomSettings.guestAccess = e;
        room.emit("guestAccess", e);

        if (e === "deny") {
            var users = room.data.users.slice();
            for (var i of users) {
                if (i.authId.indexOf("guest:") === 0) {
                    room.emitToUser(i.authId, "disconnectReason", "guestAccess");
                    room.disconnectUser(i.authId);
                }
            }
        }

    });

    // private listener
    socket.on("private", function (e) {
        if (!room.canChange(user)) return;
        e = Boolean(e);
        if (e !== room.data.roomSettings.private) {
            room.data.roomSettings.private = e;
            room.emit("private", e);
        }
    });

    // kickUser listener
    socket.on("kickUser", function (e) {
        var targetUser = room.usersByAuthId[e.authId];
        if (targetUser) {
            if (user.role > targetUser.role) {
                var evt = {
                    authId: targetUser.authId,
                    displayName: targetUser.displayName,
                    role: targetUser.role,
                };

                room.emitToUser(targetUser.authId, "disconnectReason", "kicked");
                room.disconnectUser(targetUser.authId);

                room.emit("kickedUser", evt);
            }
        }
    });

    // banUser listener
    socket.on("banUser", function (e) {
        var targetUser = room.usersByAuthId[e.authId];
        if (targetUser) {
            if (user.role > targetUser.role) {
                var evt = {
                    authId: targetUser.authId,
                    displayName: targetUser.displayName,
                    role: targetUser.role,
                };

                room.emitToUser(targetUser.authId, "disconnectReason", "banned");
                room.disconnectUser(targetUser.authId);

                room.emit("bannedUser", evt);

                room.data.roomSettings.bannedUsersByAuthId[evt.authId] = {
                    authId: evt.authId,
                    displayName: evt.displayName,
                };

                room.cullVotes();
            }
        }
        else {
            if (user.role >= roles.mod) {
                if (typeof e.authId !== "string") return;
                if (typeof e.displayName !== "string") return;

                // validate the authId looks like an authId
                var authIdParts = e.authId.split(":");
                if (authIdParts.length !== 2) return;

                e.displayName = e.displayName || "Unknown User";

                room.emit("bannedUser", {
                    authId: e.authId,
                    displayName: e.displayName,
                    role: roles.none,
                });

                room.data.roomSettings.bannedUsersByAuthId[e.authId] = {
                    authId: e.authId,
                    displayName: e.displayName,
                };

                room.cullVotes();
            }
        }
    });

    // modUser listener
    socket.on("modUser", function (e) {
        var targetUser = room.usersByAuthId[e.authId];
        if (targetUser) {
            if (user.role >= roles.host && targetUser.role < roles.mod) {
                targetUser.role = roles.mod;
                room.emit("setRole", {
                    authId: targetUser.authId,
                    role: roles.mod,
                });
            }
        }
    });

    // transferHost listener
    socket.on("transferHost", function (e) {
        var targetUser = room.usersByAuthId[e.authId];
        if (targetUser) {
            if (user.role === roles.host && targetUser.role < roles.host) {
                user.role = roles.none;
                targetUser.role = roles.host;
                room.emit("transferredHost", {
                    oldHost: user.authId,
                    newHost: targetUser.authId,
                });
            }
        }
    });

    // unban listener
    socket.on("unbanUser", function (e) {
        var targetUser = room.data.roomSettings.bannedUsersByAuthId[e.authId];
        if (targetUser) {
            if (user.role >= roles.mod) {
                delete room.data.roomSettings.bannedUsersByAuthId[e.authId];
                room.emit("unbannedUser", targetUser);
            }
        }
    });

    // unmodUser listener
    socket.on("unmodUser", function (e) {
        var targetUser = room.usersByAuthId[e.authId];
        if (targetUser) {
            if (user.role >= roles.host && targetUser.role === roles.mod) {
                targetUser.role = roles.none;
                room.emit("setRole", {
                    authId: targetUser.authId,
                    role: roles.none,
                });
            }
        }
    });

    this.gameObj.addUser(socket, user);

};

GameRoom.prototype.removeUser = function (socket) {
    // Find the user instance
    if (this.usersByAuthId[socket.authId]) {
        var user = this.usersByAuthId[socket.authId];
        var index = this.socketsByAuthId[socket.authId].indexOf(socket);

        if (index > -1) {
            // Remove the socket
            this.socketsByAuthId[socket.authId].splice(index, 1);

            // Check if there are no more sockets connected under the same authId
            if (this.socketsByAuthId[socket.authId].length === 0) {
                // Before removing the user, call removeUser on the room object
                this.gameObj.removeUser(socket, user);

                this.info("Player " + socket.displayName +
                    " (" + socket.authId + ") has left.");

                // If so, remove the user and announce the user's departure
                index = this.data.users.indexOf(user);
                if (index > -1) {
                    this.data.users.splice(index, 1);
                }
                else {
                    throw Error("Mismatch between users and usersByAuthId in lobby " + this.type + "/" + this.name);
                }
                delete this.usersByAuthId[user.authId];
                delete this.socketsByAuthId[user.authId];

                this.emit("removeUser", user.authId);

                // If the leaving person was the host, make the next person host
                // TODO: change this to support admins later
                if (user.role === roles.host) {
                    var nextHost = this.findNextHost(index);
                    if (this.data.users.length > 0) {
                        nextHost.role = roles.host;
                        this.emit("setRole", {
                            authId: nextHost.authId,
                            role: roles.host,
                        });
                    }
                }
            }

            // Deal with removing this room in the game.server code
        }
        else {
            // This should never run, but just in case
            console.error("Socket not found in user instance " + user.authId + " in lobby " + this.type + "/" + this.name + ".");
        }
    }
    else {
        // This should also never run, but just in case
        console.error("Cannot disconnect socket from lobby " + this.type + "/" + this.name + " as it was never in that lobby.");
    }
};

GameRoom.prototype.canChange = function (user) {
    return user.role >= roles.host;
};

GameRoom.prototype.cullVotes = function () {
    var kickTimeOut = 60 * 60 * 1000;  // Time for which a votekick is valid for

    var kickFilter = function (i) {
        /*
         * Actually, scratch this first condition
         * Otherwise the host could just ban people who want to vote him off
         * and never be challenged

        // A kick is invalid if the kicker is not in the room anymore
        if (!this.usersByAuthId[i.authId]) {
            return false;
        }
        */
        // A kick in invalid if it's been too long since the votekick
        if (Date.now() - i.time > kickTimeOut) {
            return false;
        }

        return true;
    };

    for (var i in this.kickVotes) {
        this.kickVotes[i] = this.kickVotes[i].filter(kickFilter);

        // Don't count this votekick if they've been banned
        // or the remaining votekicks are 0
        if (this.kickVotes[i].length === 0 ||
            this.data.roomSettings.bannedUsersByAuthId[i]) {
            delete this.kickVotes[i];
        }
    }

    this.repickVotes = this.repickVotes.filter(kickFilter);

};

GameRoom.prototype.requiredVotesForKick = function (role) {
    if (role === roles.host) {
        // For hosts it's 5 votes minimum and half the room
        return Math.max(5, Math.ceil(0.5 * this.data.actors.length));
    }
    else {
        // Currently minimum 3 votes, or 30% of the number of players in the room
        return Math.max(3, Math.floor(0.3 * this.data.actors.length));
    }
};

// This is called when the room is deleted
// Would be a good time to stop any timeouts or intervals you set
GameRoom.prototype.deconstruct = function () {
    clearInterval(this.timeouts.cullVotesInterval);

    this.gameObj.deconstruct();
};
