(function () {

// Stop backspace from backing out the page
window.addEventListener("keydown", function (e) {
    if (e.keyIdentifier === "U+0008" || e.keyIdentifier === "Backspace" || e.key === "Backspace") {
        if (e.target == document.body) {
            e.preventDefault();
        }
    }
}, true);

window.room = {};
room.socket = io.connect({
    transports: ["websocket"],
    reconnection: false,
});

room.socket.on("onconnected", function (event) {
    room.user = event;
    room.socket.emit("joinRoom", app.room, app.roomType);
});

room.applyOptions = function () {
    // Animations
    if (localStorage.animations === "false") {
        document.body.classList.add("NoAnimations");
    }
    else {
        document.body.classList.remove("NoAnimations");
    }
    // Hide letters bar
    if (localStorage.hideLettersBar === "false") {
        document.body.classList.add("HideLettersBar");
    }
    else {
        document.body.classList.remove("HideLettersBar");
    }
};

window.addEventListener("storage", function () {
    room.applyOptions();
    room.updateSettingsTab();
});
room.applyOptions();

window.roles = {
    admin: 3,
    host: 2,
    mod: 1,
    none: 0,
};

var MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

window.escapeHTML = function (s, forAttribute) {
    s = String(s);
    return s.replace(forAttribute ? new RegExp("[&<>'\"]", "g") : /[&<>]/g,
        function(c) {
            return MAP[c];
    });
};

// Hook up the sidebar buttons
(function () {
    var tabs = document.getElementsByClassName("SidebarTab");
    var buttons = document.getElementsByClassName("SidebarButton");

    var onclick = function (e) {
        var i;
        for (i = 0; i < buttons.length; i++) {
            buttons[i].classList.remove("Active");
        }
        this.classList.add("Active");

        for (i = 0; i < tabs.length; i++) {
            if (this.dataset.tab == tabs[i].id) {
                tabs[i].classList.add("Active");
            }
            else {
                tabs[i].classList.remove("Active");
            }
        }
    };

    for (var i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener("click", onclick);
    }
})();

room.updateUsers = function () {
    var userDisplay = document.getElementById("UserCount");
    userDisplay.innerHTML = room.data.users.length;

    room.refreshUserList();
};

// roomData listener
room.socket.on("roomData", function (event) {
    room.data = event.data;
    if (room.data.empty) return;

    room.usersByAuthId = {};

    room.serverOffset = event.currentServerTime - Date.now();

    for (var i = 0; i < room.data.users.length; i++) {
        var user = room.data.users[i];
        room.usersByAuthId[user.authId] = user;
    }

    if (room.data.roomSettings.welcomeMessage) {
        room.appendToChat("Info",
            escapeHTML(room.data.roomSettings.welcomeMessage));
    }

    game.onRoomData();

    room.updateUsers();
    room.updateSettingsTab();
});

// addUser listener
room.socket.on("addUser", function (user) {
    room.data.users.push(user);
    room.usersByAuthId[user.authId] = user;

    room.updateUsers();

    // Join message
    room.appendToChat("Info", room.userName(user) + " has joined.");
});

// removeUser listener
room.socket.on("removeUser", function (authId) {
    var user = room.usersByAuthId[authId];
    var index = room.data.users.indexOf(user);

    // Leave message
    room.appendToChat("Info", room.userName(user) + " has left.");

    room.data.users.splice(index, 1);
    delete room.usersByAuthId[authId];

    room.updateUsers();
});

// chatMessage listener
room.socket.on("chatMessage", function (event) {
    var user = room.usersByAuthId[event.authId];
    room.addChatMessage(user, event.message);
});

room.socket.on("serverMessage", function (event) {
    room.appendToChat("Info", room.userName({
        authId: "server:0",
        displayName: "Server",
        role: 999,
    }) + ": " + event);
});

// setRole listener
room.socket.on("setRole", function (event) {
    var user = room.usersByAuthId[event.authId];
    user.role = event.role;

    if (room.user.authId === event.authId) {
        room.user.role = event.role;
    }

    var roleText;
    switch (event.role) {
        case roles.admin:
            roleText = "an Admin";
            break;
        case roles.host:
            roleText = "the Host";
            break;
        case roles.mod:
            roleText = "a Moderator";
            break;
        default:
            roleText = "role-less";
            break;
    }

    room.appendToChat("Info", room.userName(user)  + " is now " + roleText + ".");

    room.updateSettingsTab();
    room.refreshUserList();
});

// welcomeMessage listener
room.socket.on("welcomeMessage", function (message) {
    room.data.roomSettings.welcomeMessage = message;
    room.appendToChat("Info",
        "The welcome message has been set to \"" +
        escapeHTML(message) + "\".");

    room.updateSettingsTab();
});

// guestAccess listener
room.socket.on("guestAccess", function (access) {
    room.data.roomSettings.guestAccess = access;

    if (access === "noChat" && room.user.authId.indexOf("guest:") === 0) {
        document.getElementById("ChatInput").disabled = true;
        document.getElementById("ChatInput").placeholder =
            "Guests aren't allowed to chat in this room. Sign in to send chat messages.";
    }
    else {
        document.getElementById("ChatInput").disabled = false;
        document.getElementById("ChatInput").placeholder =
            "Type here to chat.";
    }

    room.updateSettingsTab();
});

room.socket.on("private", function (e) {
    room.data.roomSettings.private = e;
    if (e) {
        room.appendToChat("Info", "This room is now set to private.");
    }
    else {
        room.appendToChat("Info", "This room is now set to public.");
    }

    room.updateSettingsTab();
});

// kickedUser listener
room.socket.on("kickedUser", function (user) {
    room.removeUserMessages(user.authId);
    room.appendToChat("Info", room.userName(user) + " has been kicked.");
});

// bannedUser listener
room.socket.on("bannedUser", function (user) {
    room.removeUserMessages(user.authId);
    room.appendToChat("Info", room.userName(user) + " has been banned.");
    room.data.roomSettings.bannedUsersByAuthId[user.authId] = {
        authId: user.authId,
        displayName: user.displayName,
    };
});

// transferredHost listener
room.socket.on("transferredHost", function (evt) {
    var oldHost = room.usersByAuthId[evt.oldHost];
    var newHost = room.usersByAuthId[evt.newHost];

    oldHost.role = roles.none;
    newHost.role = roles.host;

    if (evt.oldHost === room.user.authId) {
        room.user.role = roles.none;
    }
    if (evt.newHost === room.user.authId) {
        room.user.role = roles.host;
    }

    room.appendToChat("Info",
        room.userName(oldHost) + " has transferred host to " +
        room.userName(newHost) + ".");

    room.updateSettingsTab();
    room.refreshUserList();
});

// voteKicked listener
room.socket.on("voteKicked", function (evt) {
    var kicker = room.usersByAuthId[evt.kicker];
    var kickee = room.usersByAuthId[evt.kickee];

    room.appendToChat("Info",
        room.userName(kicker) + " has voted to kick " + room.userName(kickee) + ".");
});

// repickVote listener
room.socket.on("repickVote", function (evt) {
    var user = room.usersByAuthId[evt.authId];

    room.appendToChat("Info", room.userName(user) + " has voted for a new host.");
});

// repick listener
room.socket.on("repicked", function (evt) {
    if (evt.failed) {
        room.appendToChat("Info",
            "Choosing new host failed: no other eligible users.");
        return;
    }

    var oldHost = room.usersByAuthId[evt.oldHost];
    var newHost = room.usersByAuthId[evt.newHost];

    oldHost.role = roles.none;
    newHost.role = roles.host;

    if (evt.oldHost === room.user.authId) {
        room.user.role = roles.none;
    }
    if (evt.newHost === room.user.newHost) {
        room.user.role = roles.host;
    }

    room.appendToChat("Info",
        room.userName(newHost) + " has been voted up as host.");

    room.updateSettingsTab();
    room.refreshUserList();
});

// unbannedUser listener
room.socket.on("unbannedUser", function (evt) {
    var user = room.data.roomSettings.bannedUsersByAuthId[evt.authId];

    delete room.data.roomSettings.bannedUsersByAuthId[evt.authId];
    room.appendToChat("Info", room.userName(user) + " has been unbanned.");

    room.refreshUserList();
});

room.disconnectReason = {
    chat: "Disconnected.",
    reason: "disconnected",
};
// disconnectReason listener
room.socket.on("disconnectReason", function (reason) {
    switch (reason) {
        case "kicked":
            room.disconnectReason = {
                chat: "You've been kicked from this room.",
                reason: "kicked",
            };
            break;
        case "banned":
            room.disconnectReason = {
                chat: "You've been banned from this room.",
                reason: "banned",
            };
            break;
        case "guestAccess":
            room.disconnectReason = {
                chat: "Guests cannot play in this room. Please sign in or find another room.",
                reason: "guestAccess",
            };
            break;
        default:
            room.disconnectReason = {
                chat: "Disconnected.",
                reason: "disconnected",
            };
            break;
    }
});

// disconnect listener
room.socket.on("disconnect", function () {
    room.appendToChat("Info", room.disconnectReason.chat);

    game.onDisconnected(room.disconnectReason.reason);
});

var scoreboard = document.getElementById("Scoreboard");
var scoreboardToggle = document.getElementById("ShowScoreboard");
scoreboardToggle.addEventListener("click", function () {
    room.checkAndScrollChat(function () {
        if (scoreboard.classList.contains("Open")) {
            scoreboard.classList.remove("Open");
            localStorage.scoreboard = "closed";
        }
        else {
            scoreboard.classList.add("Open");
            localStorage.scoreboard = "open";
        }
    });
});

if (localStorage.scoreboard === "open") {
    scoreboard.classList.add("Open");
}

/* Chat Tab code */

var chatLog = document.getElementById("ChatLog");
var maxChatMessages = 100;
var scrollTolerance = 100;

room.appendToChat = function (classes, message) {
    var time = new Date();
    var hours = time.getHours();
    var minutes = time.getMinutes();
    if (hours < 10) hours = "0" + hours;
    if (minutes < 10) minutes = "0" + minutes;

    message = Autolinker.link(message, {
        newWindow: true,
        stripPrefix: false,
        urls: true,
        email: false,
        phone: false,
        twitter: false,
        hashtag: false,
    });

    room.checkAndScrollChat(function () {
        chatLog.insertAdjacentHTML(
            "beforeend", "<li class=\"" + classes + "\"><span class=\"Time\">" +
            hours + ":" + minutes + "</span>" +
            message + "</li>");

        while (chatLog.children.length > maxChatMessages) {
            chatLog.removeChild(chatLog.firstChild);
        }
    });

};

room.removeUserMessages = function (authId) {
    room.checkAndScrollChat(function () {
        var messages = chatLog.querySelectorAll(".ChatMessageInner[data-auth-id=\"" + escapeHTML(authId) + "\"]");
        for (var i = 0; i < messages.length; i++) {
            messages[i].className += " removed";
            messages[i].innerHTML = "message removed";
        }
    });
}

room.removeMessage = function (messageId) {

}

var moreMessagesNotice = document.getElementById("MoreMessagesNotice");

chatLog.addEventListener("scroll", function (e) {
    room.checkAndScrollChat(null, true);
});

moreMessagesNotice.addEventListener("click", function (e) {
    chatLog.scrollTop = chatLog.scrollHeight;
});

room.checkAndScrollChat = function (action, dontScroll) {
    var shouldScroll = (chatLog.scrollTop >
        chatLog.scrollHeight - chatLog.clientHeight - scrollTolerance);

    if (action) action();

    if (shouldScroll) {
        if (!dontScroll)
            chatLog.scrollTop = chatLog.scrollHeight;
        moreMessagesNotice.classList.remove("Active");
    }
    else {
        moreMessagesNotice.classList.add("Active");
    }
};

room.userName = function (user) {
    if (!user) return "undefined";

    var rank;
    switch (user.role) {
        case roles.admin:
            rank = "<i class=\"Admin fa fa-star fa-fw\"></i>";
            break;
        case roles.host:
            rank = "<i class=\"Host fa fa-star-o fa-fw\"></i>";
            break;
        case roles.mod:
            rank = "<i class=\"Mod fa fa-circle-o fa-fw\"></i>";
            break;
        default:
            rank = "";
            break;
    }

    return "<span class=\"DisplayName\" data-auth-id=\"" +
        escapeHTML(user.authId, true) + "\" data-display-name=\"" +
        escapeHTML(user.displayName, true) + "\">" + rank +
        escapeHTML(user.displayName) + "</span>";
};

// This will change as the authentication system changes
room.addChatMessage = function(user, message) {
    var content = "";

    content += (
        "<span class=\"ChatMessageInner\" data-auth-id=\"" + escapeHTML(user.authId) + "\">" +
        room.userName(user) + ": " + "<span class=\"ChatMessageContent\">" + escapeHTML(message) + "</span>" +
        "</span>");

    room.appendToChat("ChatMessage", content);
};

document.getElementById("ChatInput")
    .addEventListener("keydown", function (event) {
        if (event.keyCode === 13 && !event.shiftKey) {
            event.preventDefault();
            if (this.value !== "") {
                room.socket.emit("chatMessage", this.value);
            }
            this.value = "";
        }
});

/* Users Tab Code */
var usersTabButtons = document.getElementsByClassName("UsersTabButton");
var userFilter = document.getElementById("UserFilter");
var userList = document.getElementById("UserList");

var linkUserTabButtons = function () {
    for (var i = 0; i < usersTabButtons.length; i++) {
        usersTabButtons[i].classList.remove("Active");
    }
    this.classList.add("Active");

    room.refreshUserList();
};
(function () {
    for (var i = 0; i < usersTabButtons.length; i++) {
        usersTabButtons[i].addEventListener("click", linkUserTabButtons);
    }
})();

room.refreshUserList = function () {
    var i;
    var users = room.data.users.slice();

    for (i = 0; i < usersTabButtons.length; i++) {
        if (usersTabButtons[i].classList.contains("Active")) {
            switch (usersTabButtons[i].dataset.tab) {
                case "CurrentTab":
                    break;
                case "BannedTab":
                    users = [];
                    for (var j in room.data.roomSettings.bannedUsersByAuthId) {
                        users.push(room.data.roomSettings.bannedUsersByAuthId[j]);
                    }
                    break;
                default:
                    break;
            }
            break;
        }
    }

    users = users.filter(function (i) {
        return i.displayName.toLowerCase().search(userFilter.value.toLowerCase()) > -1;
    });

    var HTML = "";

    for (i = 0; i < users.length; i++) {
        var rank;
        switch (users[i].role) {
            case roles.admin:
                rank = " Admin";
                break;
            case roles.host:
                rank = " Host";
                break;
            case roles.mod:
                rank = " Mod";
                break;
            default:
                rank = "";
                break;
        }

        HTML += "<li class=\"UsersTabUser" + rank + "\"" +
            " data-auth-id=\"" + escapeHTML(users[i].authId, true) +
            "\" data-display-name=\"" +
            escapeHTML(users[i].displayName, true) + "\">" +
                escapeHTML(users[i].displayName) +
        "</li>";
    }

    userList.innerHTML = HTML;
};
userFilter.addEventListener("input", room.refreshUserList);

/* User Modal Code */
var userModal = document.getElementById("UserModal");
var userActions = document.getElementById("UserActions");

room.activateModal = function (targetUser, y) {
    userModal.style.visibility = "visible";
    userActions.dataset.authId = targetUser.authId;
    userActions.dataset.displayName = targetUser.displayName;

    var userActionHTML = function (options) {
        return "<div class=\"UserAction\" data-action=\"" +
            options.action + "\">" +
            options.name +
            "</div>";
    };

    var serviceLogo = "<i class=\"fa ";
    switch (targetUser.authId.split(":")[0]) {
        case "steam":
            serviceLogo += "fa-steam";
            break;
        case "twitter":
            serviceLogo += "fa-twitter";
            break;
        case "facebook":
            serviceLogo += "fa-facebook-official";
            break;
        case "twitch":
            serviceLogo += "fa-twitch";
            break;
        case "google":
            serviceLogo += "fa-google-plus";
            break;
        case "server":
            serviceLogo += "fa-server";
            break;
        default:
            serviceLogo += "fa-question";
            break;
    }
    serviceLogo += "\"></i>";

    userActions.innerHTML =
    "<div class=\"UserAction Disabled\" data-action=\"none\">" +
        serviceLogo + escapeHTML(
            targetUser.displayName ? targetUser.displayName : "???") +
        "</div>";

    if (targetUser.authId === room.user.authId) {
        userActions.innerHTML +=
            "<div class=\"UserAction Disabled\" data-action=\"none\">" +
                "This is you." + "</div>";
    }

    if (targetUser.isNotHere) {
        userActions.innerHTML +=
            "<div class=\"UserAction Disabled\" data-action=\"none\">" +
                "This user is not in this room." + "</div>";
    }

    var actions = [
        {
            action: "removeMessage",
            name: "Remove Message",
            allowed: function (user) { return room.user.role > 0 && user.messageId; },
        },
        {
            action: "kickUser",
            name: "Kick",
            allowed: function (user) { return room.user.role > user.role && !user.isNotHere; },
        },
        {
            action: "banUser",
            name: "Ban",
            allowed: function (user) { return room.user.role > user.role && !user.isBanned; },
        },
        {
            action: "modUser",
            name: "Mod",
            allowed: function (user) { return room.user.role >= 2 && user.role < 1 && !user.isNotHere; }
        },
        {
            action: "transferHost",
            name: "Transfer Host",
            allowed: function (user) { return room.user.role >= 2 && user.role < 2 && !user.isNotHere; }
        },
        {
            action: "unbanUser",
            name: "Unban",
            allowed: function (user) { return room.user.role >= 1 && user.isBanned; }
        },
        {
            action: "unmodUser",
            name: "Unmod",
            allowed: function (user) { return room.user.role >= 2 && user.role === 1; }
        },
    ];

    actions = actions.filter(function (i) { return i.allowed(targetUser); });

    userActions.innerHTML += actions
        .map(userActionHTML)
        .join("");

    var tolerance = 20;
    var showArrow = true;
    var top = y - userActions.clientHeight / 2;
    if (top < tolerance) {
        top = tolerance;
        showArrow = false;
    }
    else if (top + userActions.clientHeight > window.innerHeight - 20) {
        top = window.innerHeight - 20 - userActions.clientHeight;
        showArrow = false;
    }

    userActions.style.top = top + "px";

    if (showArrow) {
        userActions.innerHTML +=
            "<div class=\"UserActionsArrow\" style=\"top:" +
            (y - top - 6) + "px\"></div>";
    }
    else {
        userActions.innerHTML += "<div></div>";
    }
};

room.deactivateModal = function () {
    userModal.style.visibility = "hidden";
};

// Hook up user modal events
(function () {
    userList.addEventListener("click", function (e) {
        if (e.target.classList.contains("UsersTabUser")) {
            var user;

            if (room.usersByAuthId[e.target.dataset.authId]) {
                user = room.usersByAuthId[e.target.dataset.authId];
            }
            else {
                user = {
                    authId: e.target.dataset.authId,
                    displayName: e.target.dataset.displayName,
                    role: roles.none,
                    isNotHere: true,
                    isBanned: !!room.data.roomSettings.bannedUsersByAuthId[e.target.dataset.authId],
                };
            }

            room.activateModal(user, e.clientY);
        }
    });

    chatLog.addEventListener("click", function (e) {
        if (e.target.classList.contains("DisplayName")) {
            var user;

            if (room.usersByAuthId[e.target.dataset.authId]) {
                user = Object.assign({
                    messageId: e.target.dataset.messageId,
                }, room.usersByAuthId[e.target.dataset.authId]);
            }
            else if (e.target.dataset.authId === "server:0") {
                user = {
                    authId: e.target.dataset.authId,
                    displayName: e.target.dataset.displayName,
                    role: 999,
                    messageId: e.target.dataset.messageId,
                };
            }
            else {
                user = {
                    authId: e.target.dataset.authId,
                    displayName: e.target.dataset.displayName,
                    messageId: e.target.dataset.messageId,
                    role: roles.none,
                    isNotHere: true,
                    isBanned: !!room.data.roomSettings.bannedUsersByAuthId[e.target.dataset.authId],
                };
            }

            room.activateModal(user, e.clientY);
        }
    });

    userActions.addEventListener("mouseover", function (e) {
        for (var i = 0; i < userActions.children.length; i++) {
            if (userActions.children[i].dataset.stage) {
                delete userActions.children[i].dataset.stage;
                userActions.children[i].innerHTML =
                    userActions.children[i].dataset.text;
            }
        }
    });

    userModal.addEventListener("click", function (e) {
        if (e.target.classList.contains("UserAction")) {
            switch (e.target.dataset.action) {
                case "removeMessage":
                case "kickUser":
                case "banUser":
                case "modUser":
                case "transferHost":
                    if (e.target.dataset.stage !== "1") {
                        e.target.dataset.text = e.target.innerHTML;
                        e.target.innerHTML = "Are you sure?";
                        e.target.dataset.stage = "1";
                    }
                    else {
                        room.socket.emit(e.target.dataset.action, {
                            authId: userActions.dataset.authId,
                            displayName: userActions.dataset.displayName,
                        });
                        room.deactivateModal();
                    }
                    break;
                case "unbanUser":
                case "unmodUser":
                    room.socket.emit(e.target.dataset.action, {
                        authId: userActions.dataset.authId,
                    });
                    room.deactivateModal();
                    break;
                default:
                    room.deactivateModal();
                    break;
            }
        }
        else {
            room.deactivateModal();
        }
    });

    document.addEventListener("focus", room.deactivateModal, true);
})();

/* Settings Tab Code */
var settingsTab = document.getElementById("SettingsTab");

// Initiate settings tab
(function () {
    var i;

    // Hook up the audio slider
    var volumeSlider = document.getElementById("VolumeSlider");
    var muteButton = document.getElementById("MuteButton");
    var nonMutedValue;
    var muted = false;

    if (audio.masterGain) {
        nonMutedValue = audio.masterGain.gain.value;
        volumeSlider.value = audio.masterGain.gain.value * 100 << 0;
        volumeSlider.addEventListener("change", function (e) {
            audio.masterGain.gain.value = nonMutedValue = volumeSlider.value / 100;
            if (muted) {
                muted = false;
                muteButton.innerHTML =
                    "<div><i class=\"fa fa-volume-up fa-2x fa-fw\"></i></div>";
            }
        });
    }

    muteButton.addEventListener("click", function () {
        muted = !muted;
        if (muted) {
            muteButton.innerHTML =
                "<div><i class=\"fa fa-volume-off fa-2x fa-fw\"></i></div>";
            if (audio.masterGain) {
                audio.masterGain.gain.value = 0;
            }
            volumeSlider.value = 0;
        }
        else {
            muteButton.innerHTML =
                "<div><i class=\"fa fa-volume-up fa-2x fa-fw\"></i></div>";
            if (audio.masterGain) {
                audio.masterGain.gain.value = nonMutedValue;
            }
            volumeSlider.value = nonMutedValue * 100 << 0;
        }
    });

    var setupButtons = function (blockName, storageName, controlFunction) {
        var control = document.getElementById(blockName);
        var buttons = control.getElementsByTagName("a");
        controlFunction = controlFunction || function (e) {
            localStorage[storageName] = e.target.dataset.value;
            room.updateSettingsTab();
            room.applyOptions();
        };
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener("click", controlFunction);
        }
    };

    setupButtons("AnimationsControl", "animations");
    setupButtons("ShowLettersLeftBarControl", "hideLettersBar");

    setupButtons("GuestAccessControl", null, function (e) {
        room.socket.emit("guestAccess", e.target.dataset.value);
    });

    setupButtons("PrivateControl", null, function (e) {
        var val;
        if (e.target.dataset.value === "false") val = false;
        else val = Boolean(e.target.dataset.value);

        room.socket.emit("private", val);
    });

    var welcomeMessageInput = document.getElementById("WelcomeMessageInput");
    welcomeMessageInput.addEventListener("change", function (e) {
        room.socket.emit("welcomeMessage", welcomeMessageInput.value);
    });

    game.initiateSettingsTab();
})();

room.updateSettingsTab = function () {
    var canModify = room.user.role >= roles.host;

    var welcomeMessageInput = document.getElementById("WelcomeMessageInput");
    welcomeMessageInput.value = room.data.roomSettings.welcomeMessage;
    welcomeMessageInput.disabled = !canModify;

    document.getElementById("GuestAccessControl")
        .classList[canModify ? "remove" : "add"]("Disabled");

    document.getElementById("PrivateControl")
        .classList[canModify ? "remove" : "add"]("Disabled");

    var highlightValue = function (blockName, value) {
        var control = document.getElementById(blockName);
        var buttons = control.getElementsByTagName("a");
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].dataset.value === String(value)) {
                buttons[i].classList.add("Selected");
            }
            else {
                buttons[i].classList.remove("Selected");
            }
        }
    };

    highlightValue("AnimationsControl",
        (localStorage.animations === "false" ? "false" : "true"));
    highlightValue("ShowLettersLeftBarControl",
        (localStorage.hideLettersBar === "false" ? "false" : "true"));

    highlightValue("GuestAccessControl", room.data.roomSettings.guestAccess);
    highlightValue("PrivateControl", room.data.roomSettings.private);

    game.updateSettingsTab();
};

game.init();

// Enable shortcuts everywhere
Mousetrap.prototype.stopCallback = function (e, element, combo) {
    return false;
};

// Switch to message box
Mousetrap.bind("alt+m", function () {
    document.getElementById("ChatInput").focus();
    return false;
});

// Konami code
Mousetrap.bind("up up down down left right left right b a enter", function () {
    var konami = document.getElementById("Konami");
    if (konami) {
        if (konami.classList.contains("show"))
            konami.classList.remove("show");
        else
            konami.classList.add("show");
    }
    return false;
});

})();
