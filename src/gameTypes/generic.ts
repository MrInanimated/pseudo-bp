import { extend } from "../utils";

// Temporary hackish thing
// Will reimplement with proper typescript at some point

export interface User {
    displayName: string;
    authId: string;
    role: number;
    profileImage?: string;
}

export interface Actor {
    displayName: string;
    authId: string;
    profileImage?: string;
}

export class GenericRoom {
    room: any;
    disableJoins: boolean;

    constructor(room) {
        this.room = room;
        room.type = "generic";

        let data = this.dataObj();
        data.nextRoundSettings = extend({}, data.currentRoundSettings);
        extend(this.room.data, data);

        room.actorsByAuthId = {};
    }

    // Should be overidden to return the appropriate data object
    dataObj(): any {
        return {
            actors: [],
            state: "waiting",

            currentRoundSettings: this.defaultRoundSettings(),
        };
    }

    // Should be overridden
    defaultRoundSettings() {
        return {

        };
    }

    // Should be overridden
    newActor(user: User) {
        return {
            displayName: user.displayName,
            authId: user.authId,
            profileImage: user.profileImage,
        };
    }

    addUser(socket, user: User) {
        var room = this.room;
        var game = this;

        if (!game.disableJoins) {

            // join listener
            socket.on("join", function () {
                if (room.actorsByAuthId[user.authId]) return;
                game.join(user);
            });

            // leave listener
            socket.on("leave", function () {
                if (room.actorsByAuthId[user.authId]) {
                    game.leave(room.actorsByAuthId[user.authId]);
                }
            });

        }
    }

    join(user: User, options?: any) {
        var room = this.room;
        var options = options || {};

        if (room.actorsByAuthId[user.authId]) return;

        var actor = this.newActor(user);
        extend(actor, options);
        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;

        room.emit("addActor", actor);
    }

    leave(actor: Actor) {
        var room = this.room;
        var index = room.data.actors.indexOf(actor);

        room.emit("removeActor", actor);
        room.data.actors.splice(index, 1);
        delete room.actorsByAuthId[actor.authId];
    }

    removeUser(socket) {
        var room = this.room;

        if (room.actorsByAuthId[socket.authId]) {
            this.leave(room.actorsByAuthId[socket.authId]);
        }
    }

    // Should be overridden
    cleanUp() {
        var room = this.room;

        room.data.actors = [];
        room.actorsByAuthId = {};
    }

    deconstruct() {

    }
}

export default GenericRoom;