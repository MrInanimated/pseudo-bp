/* jshint node: true */
/* jshint esnext: true */
"use strict";

function extend(target, obj) {
    target = target || {};
    for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
            target[i] = obj[i];
        }
    }
    return target;
}

var wordLists = {
    "pokemon_gen_1": require("../misc/anticipation/pokemon_gen_1.json"),
    "pokemon_gen_2": require("../misc/anticipation/pokemon_gen_2.json"),
    "pokemon_gen_3": require("../misc/anticipation/pokemon_gen_3.json"),
    "pokemon_gen_4": require("../misc/anticipation/pokemon_gen_4.json"),
    "pokemon_gen_5": require("../misc/anticipation/pokemon_gen_5.json"),
    "pokemon_gen_6": require("../misc/anticipation/pokemon_gen_6.json"),
    "pokemon_gen_7": require("../misc/anticipation/pokemon_gen_7.json"),
};

var fs = require("fs");

function* nextPath(obj) {
    var children = Object.keys(obj);
    shuffle(children);
    for (var i of children) {
        var nextObj = obj[i];
        if (nextObj) {
            var gen = nextPath(nextObj);
            while (true) {
                var value = gen.next();
                if (value.done) {
                    break;
                }
                yield value.value;
            }
        }
        yield i;
    }
}

function shuffle(array) {
    for (var i = array.length - 1; i--; i > 0) {
        var j = Math.random() * (i + 1) | 0;
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}

var GenericRoom = require("./generic.js").GenericRoom;
var SketchRoom = require("./sketch.js").SketchRoom;

class AnticipationRoom extends GenericRoom {
    constructor(room) {
        super(room);
        room.type = "anticipation";

        this.disableJoins = true;

        this.timeouts = {};

        room.word = null;
        room.drawing = null;

        room.buffer = [];

        this.lastWords = [];
        this.lastWordsByKey = {};
        this.lastWordTail = 0;

        this.drawingInterval = null;
    }

    newDrawing() {
        var room = this.room;
        var game = this;

        var tries = 0;
        var word;

        var total = 0;
        for (let i of room.data.currentRoundSettings.wordLists) {
            total += wordLists[i].words.length;
        }

        var chosenList;
        do {
            var chosenIndex = Math.random() * total | 0;
            for (let i of room.data.currentRoundSettings.wordLists) {
                if (chosenIndex >= wordLists[i].words.length) {
                    chosenIndex -= wordLists[i].words.length;
                }
                else {
                    word = wordLists[i].words[chosenIndex];
                    chosenList = i;
                    break;
                }
            }
            tries++;
        } while (
            this.lastWordsByKey[word] &&
            tries <= 100
        );

        // Delete the word that was at this position and replace with new
        var last = this.lastWords[this.lastWordTail];
        if (this.lastWordsByKey[last]) {
            var index = this.lastWordsByKey[last].indexOf(this.lastWordTail);
            if (index > -1)
                this.lastWordsByKey[last].splice(index, 1);
            if (this.lastWordsByKey[last].length === 0)
                delete this.lastWordsByKey[last];
        }

        this.lastWords[this.lastWordTail] = word;
        if (!this.lastWordsByKey[word])
            this.lastWordsByKey[word] = [];
        this.lastWordsByKey[word].push(this.lastWordTail);

        this.lastWordTail++;
        if (this.lastWordTail > 200) {
            this.lastWordTail = 0;
        }

        var temp = word.replace(/\]/g, "").split("[").map(i => i.trim());
        word = temp[0];
        room.word = {
            word: word,
            regex: temp.map(i => SketchRoom.regexify(i)),
            prefix: temp.map(i => SketchRoom.regexify(i, true)),
        };

        var choice = wordLists[chosenList].contours[word];
        var filename = choice[Math.random() * choice.length | 0];

        fs.readFile(__dirname + "/../misc/anticipation/pokemon/" + filename, "utf8", function (err, data) {
            if (err) {
                console.error(err);
                for (var user of room.data.users.slice()) {
                    room.disconnectUser(user.authId);
                }
                return;
            }
            var drawing = JSON.parse(data);

            var pathNum = 0;
            var progress = 0;

            var gen = nextPath(drawing.hierarchy);
            var buffer = [];

            var nextPaths = function (num, speed) {
                var result = [];
                while (num-- !== 0) {
                    var path = drawing.contours[pathNum];
                    if (!path) {
                        break;
                    }

                    var slice = path.slice(progress, progress + speed + 1);
                    progress += speed;
                    if (progress >= path.length - 1) {
                        progress = 0;
                        if (path.length) {
                            slice.push(path[0]);
                        }
                        let val = gen.next();
                        if (val.done) {
                            num = 0;
                            // break but execute the code after first
                        }
                        pathNum = val.value;
                    }
                    result.push(slice);
                }
                buffer = buffer.concat(result);
                return result;
            };

            if (game.drawing) {
                game.drawing.clear();
            }

            game.drawing = {
                getBuffer: () => buffer,
                getRemaining: () => nextPaths(-1, 100),
                clear: function () {
                    buffer = null;
                    drawing = null;
                    gen = null;
                    clearInterval(game.drawingInterval);
                },
            };

            game.drawingInterval = setInterval(function () {
                room.emit("drawLines", nextPaths(6, room.data.currentRoundSettings.drawSpeed));
            }, 100);
        });
    }

    dataObj() {
        return extend(super.dataObj(), {
            round: 0,
            roundStart: 0,
            lastWord: "",
            guessed: [],
        });
    }

    defaultRoundSettings() {
        return {
            wordLists: [
                "pokemon_gen_1",
                "pokemon_gen_2",
                "pokemon_gen_3",
                "pokemon_gen_4",
                "pokemon_gen_5",
                "pokemon_gen_6",
                "pokemon_gen_7",
            ],
            gameLength: 10,
            roundTimer: 30 * 1000,
            drawSpeed: 2,
        };
    }

    newActor(user) {
        return extend(super.newActor(user), {
            score: 0,
            afk: false,
            successful: false,
        });
    }

    addUser(socket, user) {
        super.addUser(socket, user);

        var room = this.room;
        var game = this;

        socket.on("settings:wordLists", function (event) {
            if (!room.canChange(user)) return;

            if (!wordLists[event.wordList]) return;
            if (event.operation !== "add" || event.operation !== "remove")

                room.data.nextRoundSettings.wordLists =
                    room.data.nextRoundSettings.wordLists.slice();

            if (event.operation === "add") {
                if (room.data.nextRoundSettings.wordLists.indexOf(event.wordList) === -1) {
                    room.data.nextRoundSettings.wordLists.push(event.wordList);

                    room.emit("settings:wordLists", {
                        list: room.data.nextRoundSettings.wordLists,
                        operation: "add",
                        wordList: event.wordList
                    });
                }
            }
            else if (event.operation === "remove") {
                if (room.data.nextRoundSettings.wordLists.length === 1) {
                    return;
                }

                var index = room.data.nextRoundSettings.wordLists.indexOf(event.wordList);
                if (index > -1) {
                    room.data.nextRoundSettings.wordLists.splice(index, 1);

                    room.emit("settings:wordLists", {
                        list: room.data.nextRoundSettings.wordLists,
                        operation: "remove",
                        wordList: event.wordList,
                    });
                }
            }
        });

        // Just add to the game straight away
        game.join(user);

        if (this.drawing) {
            socket.emit("drawLines", this.drawing.getBuffer());
        }
    }

    join(user) {
        super.join(user);
        this.addActiveActor(user);
    }

    leave(actor) {
        super.leave(actor);
        this.removeActiveActor(actor);
    }

    toggleAFK(actor) {
        var room = this.room;
        if (actor.afk) {
            actor.afk = false;
            this.addActiveActor(actor);
        }
        else {
            actor.afk = true;
            this.removeActiveActor(actor);
        }

        room.emit("afk", { authId: actor.authId, afk: actor.afk });
    }

    addActiveActor(user) {
        // Remember if this method is changed to use properties of user objects
        // it will break
        var room = this.room;

        if (room.data.actors.filter(i => !i.afk).length === 2) {
            this.startGame();
        }
    }

    removeActiveActor(actor) {
        // see note in addActor
        var room = this.room;

        if (room.data.actors.filter(i => !i.afk).length === 0) {
            return; // Hang tight
        }
        else if (room.data.actors.filter(i => !i.afk).length === 1) {
            this.setState("waiting");
            return;
        }

        // If this makes it so that everyone left has guessed,
        // Then end the round
        if (room.data.state === "drawing" &&
            room.data.actors.every(i =>
                i.successful || i.afk
            )
        ) {
            this.setState("result");
        }

    }

    setState(newState) {
        var room = this.room;
        var game = this;

        if (["waiting", "drawing", "result", "ending"]
            .includes(newState)) {
            room.data.state = newState;
        }
        else {
            throw Error("Invalid state \"" + newState + "\" provided to setState.");
        }

        room.emit("setState", newState);
        room.debug("Switching state to " + newState);

        game.clearAllTimeouts();
        switch (newState) {
            case "waiting":
                game.cleanUp();
                break;
            case "drawing":
                this.nextRound();
                break;
            case "result":
                this.reveal();
                break;
            case "ending":
                this.endGame();
                break;
        }
    }

    startGame() {
        this.clearAllTimeouts();
        var room = this.room;
        room.data.currentRoundSettings = room.data.nextRoundSettings;
        room.data.nextRoundSettings = extend({}, room.data.currentRoundSettings);

        this.cleanUp();

        this.setState("drawing");
    }

    nextRound() {
        var room = this.room;
        var game = this;

        room.data.roundStart = Date.now();

        room.emit("newRound");

        room.data.rounds++;
        this.timeouts.resultTimeout =
            setTimeout(() => game.setState("result"), room.data.currentRoundSettings.roundTimer);

        for (var actor of room.data.actors) {
            actor.successful = false;
        }
        room.data.guessed.length = 0;

        // TODO: start drawing
        this.newDrawing();
    }

    reveal() {
        var room = this.room;
        var game = this;

        room.data.lastWord = room.word.word;
        room.emit("reveal", {
            word: room.word.word,
        });
        // TODO: push the rest of the drawing buffer

        if (this.drawing)
            room.emit("drawLines", this.drawing.getRemaining());

        if (room.data.rounds >= room.data.currentRoundSettings.gameLength) {
            this.timeouts.endGameTimeout =
                setTimeout(() => game.setState("ending"), 5 * 1000);
        }
        else {
            this.timeouts.nextRoundTimeout =
                setTimeout(() => game.setState("drawing"), 5 * 1000);
        }
    }

    endGame() {
        var room = this.room;
        var game = this;

        var maxScore = 0;
        var winners = [];
        for (var actor of room.data.actors) {
            if (actor.score >= maxScore) {
                if (actor.score > maxScore) {
                    maxScore = actor.score;
                    winners.length = 0;
                }
                winners.push(actor);
            }
        }

        room.emit("endGame", {
            winners: winners.map(i => i.authId),
            score: maxScore,
        });

        this.timeouts.nextRoundTimeout = setTimeout(function () {
            game.startGame();
        }, 15 * 1000);
    }

    onChatMessage(user, message) {
        var room = this.room;

        if (message.startsWith("/")) {
            // handle commands
            var args = message.substring(1).split(" ").filter(i => i.length);

            if (args.length === 0)
                return true;

            switch (args[0].toLowerCase()) {
                case "afk":
                    this.toggleAFK(room.actorsByAuthId[user.authId]);
                    break;
            }

            return true;
        }
        else {
            // Dunno how this would happen
            // But if somehow the user is not part of the game
            // Don't worry about the message
            if (!room.actorsByAuthId[user.authId]) return false;

            // Don't worry if the current state isn't drawing
            if (room.data.state !== "drawing")
                return false;

            var fit = SketchRoom.checkWord(message, room.word);

            var actor = room.actorsByAuthId[user.authId];
            if (fit === 2) {
                if (actor.successful)
                    return true;

                actor.successful = true;

                var timeSinceStart = Date.now() - room.data.roundStart;
                var score = (room.data.currentRoundSettings.roundTimer * 1.5 - timeSinceStart) / 1000;
                score = Math.round(score);

                if (room.data.guessed.length === 0)
                    score += 5;

                actor.score += score;
                room.data.guessed.push(actor.authId);

                room.emitToUser(user.authId, "success", {
                    word: room.word.word,
                    score: score,
                });

                room.emit("successfulGuess", {
                    authId: user.authId,
                    score: actor.score,
                });

                // If everyone has guessed, advance the state
                if (room.data.actors.every(i =>
                    i.successful || i.afk
                )
                ) {
                    this.setState("result");
                }

                return true;
            }
            else if (fit == 1) {
                if (actor.successful)
                    return true;

                room.emitToUser(user.authId, "almost", {
                    almost: message,
                });

                return true;
            }

            return false;
        }
    }

    clearAllTimeouts() {
        for (var i in this.timeouts) {
            clearTimeout(this.timeouts[i]);
        }
        this.timeouts = [];
        clearInterval(this.drawingInterval);
        this.drawingInterval = null;
    }

    cleanUp() {
        // Don't actually want this because we're preserving the
        // actors list between games
        //super.cleanUp();

        var room = this.room;

        for (var actor of room.data.actors) {
            actor.score = 0;
            actor.successful = false;
        }

        this.clearAllTimeouts();
        room.word = "";
        if (room.drawing) {
            room.drawing.clear();
            room.drawing = null;
        }

        room.data.rounds = 0;
    }

    deconstruct() {
        var room = this.room;
        super.deconstruct();

        this.clearAllTimeouts();
        if (room.drawing) {
            room.drawing.clear();
        }
    }
}

module.exports = AnticipationRoom;
