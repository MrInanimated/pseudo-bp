/* jshint node: true*/
/* jshint esnext: true*/
"use strict";

var promptNumber = 10;

function extend (target, obj) {
    target = target || {};
    for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
            target[i] = obj[i];
        }
    }
    return target;
}

function frequency (list) {
    var freqs = {};
    for (var i = 0; i < list.length; i++) {
        if (freqs[list[i]] === undefined)
            freqs[list[i]] = 0;
        freqs[list[i]]++;
    }
    return freqs;
}

var removeDiacritics = require("../diacritics.js");

var TypeFighterRoom = module.exports = function (room) {
    this.room = room;
    room.type = "typefighter";

    this.dictionaries = room.externals.dictionaries;

    var data = {
        actors: [],
        state: "waiting",
        prompts: [],

        currentRoundSettings: {

        },

        roundStart: 0,
    };

    data.nextRoundSettings = extend({}, data.currentRoundSettings);
    extend(this.room.data, data);

    room.actorsByAuthId = {};

    this.currentDict = {};
};

/* Utility methods */
TypeFighterRoom.prototype.newDictionary = function () {
    var dictionaryFactory = this.dictionaries.en.Normal;

    this.currentDict = dictionaryFactory.newDict();
};

TypeFighterRoom.prototype.generatePrompt = function () {
    var prompt = this.currentDict.generatePrompt(
        // Maybe add an option to change these later
        2,
        3,
        -1
    );
    var score = this.currentDict.scorePrompt(prompt);
    return {
        prompt: prompt,
        score: score,
    };
};

TypeFighterRoom.prototype.useWord = function (word) {
    this.currentDict.useWord(word);
};

TypeFighterRoom.prototype.checkWord = function (word) {
    return this.currentDict.checkWord(word);
};

TypeFighterRoom.prototype.addUser = function (socket, user) {
    var room = this.room;
    var game = this;

    // setWord listener
    socket.on("setWord", function (e) {

        if (room.data.state !== "playing") return;
        if (!room.actorsByAuthId[user.authId]) return;

        if (!e.word || typeof e.word !== "string") return;

        var word = removeDiacritics(e.word.toLowerCase()).trim();
        var actor = room.actorsByAuthId[user.authId];

        room.emit("setWord", {
            authId: user.authId,
            word: word,
        });

        actor.lastWord = word;

        if (e.validate) {
            if (game.checkWord(word)) {
                game.useWord(word);

                var score = 0;
                var usedPrompts = [];

                var toUpdate = [];

                for (var i = 0; i < room.data.prompts.length; i++) {
                    var prompt = room.data.prompts[i];
                    if (word.indexOf(prompt.prompt) > -1) {
                        toUpdate.push(i);

                        score += prompt.score;
                        usedPrompts.push(prompt);
                    }
                }

                score *= usedPrompts.length;

                if (score === 0) {
                    score = -5;
                }

                actor.lastWinWord = word;
                actor.lastWord = "";

                actor.score += score;

                room.emit("winWord", {
                    authId: user.authId,
                    word: word,
                    score: actor.score,
                    delta: score,
                    prompts: usedPrompts,
                });

                actor.wordsUsed++;

                // Do a score check and end the game here
                var winner = game.checkEndGame();
                if (winner) {
                    return game.endGame(winner);
                }

                // This is deliberately after the end game check
                // So we don't waste prompt generation

                var updatedPrompts = [];
                for (var j of toUpdate) {
                    var newPrompt = {
                        index: j,
                        prompt: game.generatePrompt()
                    };

                    room.data.prompts[j] = newPrompt.prompt;

                    updatedPrompts.push(newPrompt);
                }

                room.emit("updatePrompts", {
                    prompts: updatedPrompts,
                    authId: actor.authId
                });
            }
            else {
                room.emit("failWord", {
                    authId: user.authId,
                    word: word,
                });
            }
        }

    });

    // join listener
    socket.on("join", function () {
        if (room.data.state !== "waiting" && room.data.state !== "starting") return;
        if (room.data.actors.length >= 10) return;

        if (room.actorsByAuthId[user.authId]) return;

        var actor = {
            displayName: user.displayName,
            authId: user.authId,
            profileImage: user.profileImage,

            lastWord: "",
            lastWinWord: "",

            isAlive: true,

            score: 0,
            wordsUsed: 0,
        };

        room.data.actors.push(actor);
        room.actorsByAuthId[user.authId] = actor;

        room.emit("addActor", actor);

        room.debug("Actor added.");

        if (room.data.state !== "starting")
            game.setState("starting");

    });

    socket.on("startGame", function () {
        if (room.data.state !== "starting") return;
        if (!room.data.actors[0] || room.data.actors[0].authId !== user.authId) return;

        game.setState("playing");
    });

    socket.on("leave", function () {
        if (room.actorsByAuthId[user.authId]) {
            game.leave(room.actorsByAuthId[user.authId]);
        }
    });

};

TypeFighterRoom.prototype.removeUser = function (socket) {
    var room = this.room;

    if (room.actorsByAuthId[socket.authId]) {
        this.leave(room.actorsByAuthId[socket.authId]);
    }
};

TypeFighterRoom.prototype.leave = function (actor) {
    var room = this.room;
    var index = room.data.actors.indexOf(actor);

    if (room.data.state === "waiting" || room.data.state === "starting") {
        room.data.actors.splice(index, 1);
        delete room.actorsByAuthId[actor.authId];

        if (!room.data.actors.length) {
            this.setState("waiting");
        }
    }
    else {
        actor.isAlive = false;

        var winner = this.checkEndGame();
        if (winner) {
            this.endGame(winner);
            return;
        }
    }
};

TypeFighterRoom.prototype.setState = function (newState) {
    var room = this.room;

    if (room.data.state === newState) return;

    if (["waiting", "starting", "playing"].indexOf(newState) > -1) {
        room.data.state = newState;
    }
    else {
        throw Error("Invalid state \"" + newState + "\" provided to setState.");
    }

    room.emit("setState", newState);

    switch (newState) {
        case "waiting":
        case "starting":
            break;
        case "playing":
            room.data.currentRoundSettings = extend({}, room.data.nextRoundSettings);

            this.startGame();
            break;
    }
    room.debug("Switching state to " + newState);

};

TypeFighterRoom.prototype.startGame = function () {
    var room = this.room;

    this.newDictionary();

    room.data.roundStart = Date.now();

    this.makePrompts();
};

TypeFighterRoom.prototype.makePrompts = function () {
    var room = this.room;

    room.data.prompts = [];
    for (var i = 0; i < promptNumber; i++) {
        room.data.prompts.push(this.generatePrompt());
    }

    room.emit("newPrompts", room.data.prompts);
};

TypeFighterRoom.prototype.endGame = function (winner) {
    var room = this.room;

    var elapsedTime = Date.now() - room.data.roundStart;
    room.emit("endGame", {
        authId: winner.winner ? winner.winner.authId : undefined,
        time: elapsedTime,
    });

    this.cleanUp();
    this.setState("waiting");
};

TypeFighterRoom.prototype.checkEndGame = function () {
    var room = this.room;

    var alive = room.data.actors.filter(function (a) {
        return a.isAlive;
    });

    if (alive.length <= 1 && room.data.actors.length !== 1 || alive.length === 0) {
        return {winner: alive[0]};
    }
    else {
        // Add actual winning conditions
        var winners = room.data.actors.filter(function (e) {
            return e.score >= 200;
        });

        if (winners.length) {
            return {winner: winners[0]};
        }

        return false;
    }
};

TypeFighterRoom.prototype.cleanUp = function () {
    var room = this.room;

    // delete all the actors
    room.data.actors = [];
    room.actorsByAuthId = {};

    room.data.prompts = [];

    room.data.wordCount = 0;
};

TypeFighterRoom.prototype.deconstruct = function () {
    // This is empty for now I guess
    // I don't have any long running timeouts to take care of
};