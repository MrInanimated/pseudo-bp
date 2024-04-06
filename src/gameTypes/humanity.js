/* jshint node: true*/
/* jshint esnext: true*/
"use strict";

// This is unfinished

// Yay Fisher-Yates!
// (Javascript, why do you not have a native shuffle function like all the other languages :<)
function shuffle (array) {
  var m = array.length, t, i;
  while (m) {
    i = Math.floor(Math.random() * m--);
    t = array[m];
    array[m] = array[i];
    array[i] = t;
  }
  return array;
}

function extend (target, obj) {
    target = target || {};
    for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
            target[i] = obj[i];
        }
    }
    return target;
}

var MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHTML (s, forAttribute) {
    return s.replace(forAttribute ? new RegExp("[&<>'\"]", "g") : /[&<>]/g,
        function(c) {
            return MAP[c];
    });
}

var HumanityRoom = module.exports = function (room) {
    this.room = room;
    room.type = "humanity";

    this.dictionary = room.externals.dictionaries.en.Normal.newDict();

    // Add a bunch of data variables to parent data object
    // (the parent data object is sent to all socket on connection)
    var data = {
        actors: [],

        state: "waiting",

        czar: "",
        card: "",
        prompt: "",

        hasAnswered: {},
        responses: [],
        responsePlayers: [],
        lastWinner: "",
        lastWinnerName: "",

        //currentRoundSettings: {},
    };
    //data.nextRoundSettings = extend({}, data.currentRoundSettings);
    extend(this.room.data, data);

    room.actorsByAuthId = {};
    room.privateResponses = [];
    room.nextRound = true;

    this.cardIndex = 0;
    this.cards = require("../misc/humanityCards.json");
    shuffle(this.cards);
};

HumanityRoom.prototype.generatePrompt = function () {
    return this.dictionary.generatePrompt(3);
};

HumanityRoom.prototype.generateCard = function () {
    if (this.cardIndex >= this.cards.length) {
        this.cardIndex = 0;
        shuffle(this.cards);
    }
    return this.cards[this.cardIndex++];
};

HumanityRoom.prototype.addUser = function (socket, user) {
    var room = this.room;
    var game = this;

    // join listener
    socket.on("join", function () {
        if (room.actorsByAuthId[user.authId]) return;

        var actor = {
            displayName: user.displayName,
            authId: user.authId,
            points: 0,
        };

        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;

        room.emit("addActor", actor);
        room.debug("Actor added.");

    });

    // startGame listener
    socket.on("startGame", function () {
        if (room.data.state !== "waiting") return;
        if (room.data.actors.length < 2) return;
        if (room.data.actors[0].authId !== user.authId) return;

        game.startGame();
    });

    // leave listener
    socket.on("leave", function () {
        if (room.actorsByAuthId[user.authId]) {
            game.leave(room.actorsByAuthId[user.authId]);
        }
    });

    // response listener
    socket.on("response", function (m) {
        if (room.data.state !== "answering") return;
        if (room.data.hasAnswered[user.authId]) return;
        if (room.data.czar === user.authId) return;
        if (typeof m !== "string") return;
        if (m.toLowerCase().indexOf(room.data.prompt) === -1) return;

        m = escapeHTML(m).replace(/\n/g, "<br>");

        room.data.hasAnswered[user.authId] = 1;
        room.privateResponses.push({
            authId: user.authId,
            displayName: user.displayName,
            response: m,
        });

        room.emit("response", { authId: user.authId });

        // If everyone has finished, then set state to "choosing"
        var hasFinished = true;
        for (var i of room.data.actors) {
            if (!room.data.hasAnswered[i.authId] && i.authId !== room.data.czar) {
                hasFinished = false;
            }
        }

        if (hasFinished) {
            game.setState("choosing");
        }

    });

    // forceEnd listener
    socket.on("forceEnd", function () {
        if (room.data.state !== "answering") return;
        if (room.data.czar !== user.authId) return;
        if (room.privateResponses.length < 1) return;

        game.setState("choosing");
    });

    // choice listener
    socket.on("choice", function (index) {
        if (room.data.state !== "choosing") return;
        if (room.data.czar !== user.authId) return;

        index = parseInt(index);

        if (index < 0 || index >= room.privateResponses.length) return;

        var chosenResponse = room.privateResponses[index];
        var winner = room.actorsByAuthId[chosenResponse.authId];
        if (winner) winner.points++;  // winner might've left
        room.data.lastWinner = chosenResponse.authId;
        room.data.lastWinnerName = chosenResponse.displayName;

        game.setState("revealed");
    });

    // nextRound listener
    socket.on("nextRound", function () {
        if (room.data.state !== "revealed") return;
        if (room.data.czar !== user.authId) return;

        if (room.nextRound) {
            game.setState("answering");
        }
        else {
            game.cleanUp();
            game.setState("waiting");
        }
    });

};

HumanityRoom.prototype.leave = function (actor) {
    var room = this.room;

    var index = room.data.actors.indexOf(actor);

    room.emit("removeActor", { authId: actor.authId });

    room.data.actors.splice(index, 1);
    delete room.actorsByAuthId[actor.authId];

    // Check if there's enough people in the game now
    if (room.data.actors.length < 2) {
        this.setState("waiting");
        return;
    }

    // If this user was the card czar, then restart the current round
    if (actor.authId === room.data.czar) {
        this.setState("answering");
        return;
    }

    // If the person that just left was holding everyone up without answering
    // advance to the "choosing" state
    if (room.data.state === "answering") {
        var hasFinished = true;
        for (var i of room.data.actors) {
            if (!room.data.hasAnswered[i.authId] && i.authId !== room.data.czar) {
                hasFinished = false;
            }
        }

        if (hasFinished) {
            this.setState("choosing");
            return;
        }
    }

};

HumanityRoom.prototype.removeUser = function (socket) {
    var room = this.room;

    if (room.actorsByAuthId[socket.authId]) {
        this.leave(room.actorsByAuthId[socket.authId]);
    }
};

HumanityRoom.prototype.startGame = function () {
    var room = this.room;

    // TODO copy nextRoundSettings to currentRoundSettings when they are implemented

    this.setState("answering");
};

HumanityRoom.prototype.setState = function (newState) {
    var room = this.room;

    if (["waiting", "answering", "choosing", "revealed"].indexOf(newState) > -1) {
        room.data.state = newState;
    }
    else {
        throw Error("Invalid state \"" + newState + "\" provided to setState.");
    }

    room.emit("setState", newState);

    switch (newState) {
        case "waiting":
            this.cleanUp();
            break;
        case "answering":
            this.restartRound();
            break;
        case "choosing":
            this.emitResponses();
            break;
        case "revealed":
            this.revealResponses();
            break;
    }
    room.debug("Switching state to " + newState);

};

HumanityRoom.prototype.restartRound = function () {
    var room = this.room;

    room.privateResponses = [];
    room.data.responses = [];
    room.data.responsePlayers = [];
    room.data.hasAnswered = {};

    // set the next czar
    if (room.data.czar === "") {
        var randomIndex = Math.random() * room.data.actors.length << 0;
        room.data.czar = room.data.actors[randomIndex].authId;
    }
    else {
        var index = room.data.actors.indexOf(room.actorsByAuthId[room.data.czar]);
        index = (index + 1) % room.data.actors.length;
        room.data.czar = room.data.actors[index].authId;
    }

    room.data.card = this.generateCard();
    room.data.prompt = this.generatePrompt();

    room.emit("newRound", {
        czar: room.data.czar,
        card: room.data.card,
        prompt: room.data.prompt,
    });

};

HumanityRoom.prototype.emitResponses = function () {
    var room = this.room;

    shuffle(room.privateResponses);
    room.data.responses = room.privateResponses.map(function (i) {
        return i.response;
    });

    room.emit("emitResponses", room.data.responses);
};

HumanityRoom.prototype.revealResponses = function () {
    var room = this.room;

    room.data.responsePlayers = room.privateResponses.map(function (i) {
        return {
            authId: i.authId,
            displayName: i.displayName
        };
    });

    var winThreshold = 5;
    var won = room.data.actors.filter(function (i) {
        return i.points >= winThreshold;
    });

    var end = won.length >= 1;

    room.emit("revealResponses", {
        players: room.data.responsePlayers,
        winner: room.data.lastWinner,
        winnerName: room.data.lastWinnerName,
    });

    room.nextRound = !end;
};

HumanityRoom.prototype.cleanUp = function () {
    var room = this.room;

    room.data.actors = [];
    room.actorsByAuthId = {};

    room.data.czar = "";
    room.data.responses = [];
    room.data.responsePlayers = [];
    room.data.lastWinner = "";
    room.data.lastWinnerName = "";
    room.data.hasAnswered = {};

    room.privateResponses = [];

    room.nextRound = true;
};

HumanityRoom.prototype.deconstruct = function () {

};