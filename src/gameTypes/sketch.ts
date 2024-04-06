import { GenericRoom } from "./generic";
import { extend } from "../utils";

import Ajv from "ajv";

// TODO: proper conversion into typescript

var fs = require("fs");

const validator = new Ajv();

/* Schemas */
validator.addSchema({
    $id: "/pathObjSchema",
    type: "object",
    properties: {
        start: { $ref: "/pointSchema" },
        color: { $ref: "/colorSchema" },
        tool: {
            enum: ["pen", "pencil", "eraser", "fill"],
        },
        end: { $ref: "/pointSchema" },
        width: { type: "integer", minimum: 0, maximum: 4 },
        point: {
            oneOf: [
                {
                    type: "object",
                    properties: {
                        radius: { type: "number" },
                    },
                    required: ["radius"],
                },
                {
                    enum: [false]
                },
            ],
        },
    },
    required: ["start", "color", "tool", "width"],
    additionalProperties: false,
});

var clamped = { type: "number", minimum: 0, maximum: 1};

validator.addSchema({
    $id: "/colorSchema",
    type: "object",
    properties: {
        red: clamped,
        blue: clamped,
        green: clamped,
        alpha: clamped,
    },
    required: ["red", "blue", "green", "alpha"],
    additionalProperties: false,
});

validator.addSchema({
    $id: "/pathPointSchema",
    type: "object",
    properties: {
        top: { $ref: "/pointSchema"},
        bottom: { $ref: "/pointSchema"},
    },
    required: ["top", "bottom"],
    additionalProperties: false,
});

validator.addSchema({
    $id: "/pointSchema",
    type: "object",
    properties: {
        x: { type: "number"},
        y: { type: "number"},
    },
    required: ["x", "y"],
    additionalProperties: false,
});

validator.addSchema({
    $id: "/pointArraySchema",
    type: "array",
    items: { $ref: "/pathPointSchema" },
});

var wordLists = {
    "full_english": __dirname + "/../dictionaries/english.txt",
    "english_easy": __dirname + "/../misc/sketch/english_easy.txt",
    "english_hard": __dirname + "/../misc/sketch/english_hard.txt",
    "pokemon_pre3": __dirname + "/../misc/sketch/pokemon_pre3.txt",
    "pokemon_post3": __dirname + "/../misc/sketch/pokemon_post3.txt",
    "countries": __dirname + "/../misc/sketch/countries.txt",
    "animals": __dirname + "/../misc/sketch/animals.txt",
    "games": __dirname + "/../misc/sketch/games.txt",
    "anime": __dirname + "/../misc/sketch/anime.txt",
    "food": __dirname + "/../misc/sketch/food.txt",
    "phrases": __dirname + "/../misc/sketch/phrases.txt",
};

var wordFormat = {
    "phrases": true,
};

const insignificantWords = {
    "and": 1,
    "in": 1,
    "the": 1,
    "a": 1,
    "to": 1,
    "me": 1,
    "on": 1,
    "with": 1,
    "of": 1,
    "or": 1,
    "it": 1,
    "up": 1,
    "by": 1,
    "for": 1,
    "at": 1,
    "as": 1,
};

var significantWord = function (word) {
    return !insignificantWords[word] && word.length > 2;
};

const wildCards = {
    "%possessive%": ["ones", "my", "your", "his", "her", "our", "its", "their"],
};

var wordListLengths = {};

for (var i in wordLists) {
    wordLists[i] = fs.readFileSync(wordLists[i], "utf8")
        .split(/\r?\n/g).map(i => i.trim()).filter(i => i.length);

    wordListLengths[i] = wordLists[i].length;
}

var escapeRegex = function (text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

export class SketchRoom extends GenericRoom {
    // lmao fuck proper declaration of properties
    timeouts: any;
    lastWords: any;
    lastWordsByKey: any;
    lastWordTail: any;

    constructor(room) {
        super(room);
        room.type = "sketch";

        this.disableJoins = true;

        this.timeouts = {};

        room.drawQueue = [];
        room.queueIndex = 0;
        room.word = null;

        this.lastWords = [];
        this.lastWordsByKey = {};
        this.lastWordTail = 0;
    }

    newWord() {
        var room = this.room;

        var chosenDict;
        function chooseWord () {
            chosenDict =
                room.data.currentRoundSettings.wordLists[Math.random() *
                    room.data.currentRoundSettings.wordLists.length | 0];

            var chosenIndex = Math.random() * wordLists[chosenDict].length | 0;

            return wordLists[chosenDict][chosenIndex];
        }

        var tries = 0;
        var word;
        do {
            word = chooseWord();
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

        if (wordFormat[chosenDict]) {
            return SketchRoom.wordFormat(word);
        }
        else {
            // Sort out all the alternates
            var temp = word.replace(/\]/g, "").split("[").map(i => i.trim());
            word = temp[0];

            return {
                word: word,
                regex: temp.map(i => SketchRoom.regexify(i)),
                prefix: temp.map(i => SketchRoom.regexify(i, true)),
            };
        }
    }

    dataObj() {
        return extend(super.dataObj(), {
            drawings: [],
            currentDrawing: null,

            rounds: 0,
            roundStart: 0,
            currentArtist: "",
            lastWord: "",
            hint: { state: 0 },
            guessed: [],
            passCount: 0,
        });
    }

    defaultRoundSettings() {
        return {
            gameLength: 10,
            roundTimer: 90 * 1000,
            wordLists: ["english_easy"],
            // Remember to clone when beginning a new round
        };
    }

    newActor(user) {
        return extend(super.newActor(user), {
            score: 0,
            afk: false,
        });
    }

    addUser(socket, user) {
        super.addUser(socket, user);

        var room = this.room;
        var game = this;

        // draw:progress listener
        socket.on("draw:progress", function (pathOpts, newPoints) {
            if (room.data.currentArtist !== user.authId) return;
            if (["drawing", "guessed"].indexOf(room.data.state) === -1) return;
            if (!game.validateDrawEvent(pathOpts, newPoints)) return;

            room.broadcast(socket,
                "draw:progress", socket.userId, pathOpts, newPoints);

            var data = room.data;

            // We're using userIds here (which are UUIDs) because we need
            // to differentiate between different sockets that might be
            // connected under the same user
            // Allowing multiple sockets to draw simultaneously complicates
            // the code a lot
            var currentPath = data.currentDrawing.currentPaths[socket.userId];

            if (!currentPath) {
                currentPath = pathOpts;
                currentPath.userId = socket.userId;
                currentPath.points = [];
                data.currentDrawing.currentPaths[socket.userId] = currentPath;
                data.currentDrawing.paths.push(currentPath);
            }

            currentPath.point = pathOpts.point;
            currentPath.points = currentPath.points.concat(newPoints);
        });

        socket.on("draw:end", function (pathOpts, newPoints) {
            if (room.data.currentArtist !== user.authId) return;
            if (["drawing", "guessed"].indexOf(room.data.state) === -1) return;
            if (!game.validateDrawEvent(pathOpts, newPoints)) return;
            if (!pathOpts.end) return;

            room.broadcast(socket,
                "draw:end", socket.userId, pathOpts, newPoints);

            var data = room.data;

            var currentPath = data.currentDrawing.currentPaths[socket.userId];
            if (!currentPath) {
                currentPath = pathOpts;
                currentPath.userId = socket.userId;
                currentPath.points = [];
                data.currentDrawing.paths.push(currentPath);
            }

            currentPath.points = currentPath.points.concat(newPoints);
            currentPath.end = pathOpts.end;
            delete data.currentDrawing.currentPaths[socket.userId];

        });

        socket.on("draw:undo", function (userId) {
            if (room.data.currentArtist !== user.authId) return;
            if (["drawing", "guessed"].indexOf(room.data.state) === -1) return;
            if (userId !== socket.userId) return;

            delete room.data.currentDrawing.currentPaths[userId];
            for (var i = room.data.currentDrawing.paths.length - 1; i >= 0; i--) {
                if (room.data.currentDrawing.paths[i].userId === userId) {
                    room.data.currentDrawing.paths.splice(i, 1);
                    room.broadcast(socket, "draw:undo", userId);
                    return;
                }
            }
        });

        socket.on("draw:clear", function () {
            if (room.data.currentArtist !== user.authId) return;
            room.broadcast(socket, "draw:clear");

            room.data.currentDrawing.paths = [];
            room.data.currentDrawing.currentPaths = {};
        });

        socket.on("pass", function () {
            if (room.data.state !== "drawing") return;
            if (user.authId !== room.data.currentArtist) return;

            if (room.data.passCount >= 2) return;

            room.emit("pass", { wwi: room.word.word });
            room.word = game.newWord();
            room.hint = { state: 0 };

            room.emitToUser(user.authId, "drawWord", { word: room.word.word });

            room.data.passCount++;
        });

        socket.on("skip", function () {
            if (room.data.state !== "drawing") return;
            if (user.authId !== room.data.currentArtist) return;

            room.data.rounds--;
            room.data.drawings.pop();

            room.emit("skip", { reason: "skip", wwi: room.word.word });
            game.setState("drawing");
        });

        socket.on("hint", function () {
            if (room.data.state !== "drawing") return;
            if (room.data.currentArtist !== user.authId) return;
            if (room.data.hint.state > 2) return;

            if (room.data.hint.state === 0) {
                room.data.hint.length = room.word.word.length;
            }
            else {
                room.data.hint[room.data.hint.state - 1] =
                    room.word.word[room.data.hint.state - 1];
            }

            room.emit("hint", room.data.hint);

            room.data.hint.state++;
        });

        socket.on("settings:roundTimer", function (time) {
            if (!room.canChange(user)) return;
            time = parseInt(time);

            if ([30000, 45000, 60000, 90000, 120000, 150000, 180000]
                .indexOf(time) === -1) return;
            if (room.data.nextRoundSettings.roundTimer === time) return;

            room.data.nextRoundSettings.roundTimer = time;
            room.emit("settings:roundTimer", time);
        });

        socket.on("settings:gameLength", function (gameLength) {
            if (!room.canChange(user)) return;

            gameLength = parseInt(gameLength);

            if ([5, 10, 15, 20, 30, 40, 50].indexOf(gameLength) === -1) return;
            if (gameLength === room.data.nextRoundSettings.gameLength) return;

            room.data.nextRoundSettings.gameLength = gameLength;

            room.emit("settings:gameLength", gameLength);
        });

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
    }

    validateDrawEvent(pathOpts, newPoints) {
        var valid;
        valid = validator.validate("/pathObjSchema", pathOpts);
        if (!valid)
            return;
        valid = validator.validate("/pointArraySchema", newPoints);
        if (!valid)
            return;

        return true;
    }

    setState(newState) {
        var room = this.room;
        var game = this;

        if (["waiting", "drawing", "guessed", "result", "ending"]
            .indexOf(newState) > -1
        ) {
            room.data.state = newState;
        }
        else {
            throw Error("Invalid state \"" + newState + "\" provided to setState.");
        }

        room.emit("setState", newState);

        room.debug("Switching state to " + newState);

        switch (newState) {
            case "waiting":
                this.clearAllTimeouts();
                this.cleanUp();
                break;
            case "drawing":
                game.clearAllTimeouts();

                room.data.roundStart = Date.now();
                this.timeouts.resultTimeout =
                    setTimeout(() => game.setState("result"), room.data.currentRoundSettings.roundTimer);

                this.advanceTurn();
                break;
            case "guessed":
                game.clearAllTimeouts();

                var elapsed = Date.now() - room.data.roundStart;
                var timeLeft = Math.min(30 * 1000, room.data.currentRoundSettings.roundTimer - elapsed);
                room.data.roundStart = Date.now() + timeLeft - room.data.currentRoundSettings.roundTimer;
                this.timeouts.resultTimeout =
                    setTimeout(() => game.setState("result"), timeLeft);
                break;
            case "result":
                game.clearAllTimeouts();

                this.reveal();
                break;
            case "ending":
                game.clearAllTimeouts();

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

    advanceTurn() {
        var room = this.room;

        room.data.rounds++;

        for (var actor of room.data.actors) {
            actor.successful = false;
        }

        room.queueIndex = (room.queueIndex + 1) % room.drawQueue.length;
        var authId = room.drawQueue[room.queueIndex];

        room.data.currentDrawing = {
            paths: [],
            currentPaths: {},
        };
        room.data.drawings.push(room.data.currentDrawing);

        room.data.currentArtist = authId;
        room.data.hint = { state: 0 };
        room.data.guessed = [];
        room.data.passCount = 0;

        room.word = this.newWord();

        room.emit("newRound", {
            artist: authId,
        });

        room.emitToUser(authId, "drawWord", { word: room.word.word });
    }

    reveal() {
        var game = this;
        var room = this.room;

        room.data.lastWord = room.word.word;

        room.emit("reveal", {
            word: room.data.lastWord
        });

        if (room.data.rounds >= room.data.currentRoundSettings.gameLength) {
            this.timeouts.endGameTimeout =
                setTimeout(() => game.setState("ending"), 10 * 1000);
        }
        else {
            this.timeouts.nextRoundTimeout =
                setTimeout(() => game.setState("drawing"), 10 * 1000);
        }
    }

    endGame() {
        var game = this;
        var room = this.room;

        var maxScore = 0;
        var winners: any[] = [];
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

    getDrawOrder() {
        var room = this.room;
        var authIds: any[] = [];

        for (var i = 0; i < room.drawQueue.length; i++) {
            var j = (i + room.queueIndex + 1) % room.drawQueue.length;
            authIds.push(room.drawQueue[j]);
        }

        return authIds;
    }

    onChatMessage(user, message) {
        var room = this.room;

        if (message.startsWith("/")) {
            // handle commands
            var args = message.substring(1).split(" ").filter(i => i.length);

            if (args.length === 0)
                return true;


            switch (args[0].toLowerCase()) {
                case "draworder":
                    room.emitToUser(user.authId,
                        "command:draworder", this.getDrawOrder());
                    break;
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

            // Don't worry if the current state isn't drawing or guessed
            if (room.data.state !== "drawing" && room.data.state !== "guessed")
                return false;

            // Don't let the artist talk
            if (room.data.currentArtist === user.authId) return true;

            var fit = SketchRoom.checkWord(message, room.word);

            if (fit === 2) {
                // Successful guess
                var actor = room.actorsByAuthId[user.authId];

                // Don't let a successful guesser say the word
                if (actor.successful)
                    return true;

                actor.successful = true;

                if (room.data.state === "drawing")
                    this.setState("guessed");

                var score = Math.max(5, 10 - room.data.guessed.length);
                actor.score += score;

                var artist = room.actorsByAuthId[room.data.currentArtist];
                var artistScore = 0;
                if (room.data.guessed.length === 0) {
                    artistScore = 10 - room.data.hint.state * 2;
                }
                else if (room.data.guessed.length < 6) {
                    artistScore = 1;
                }

                artist.score += artistScore;

                room.data.guessed.push(user.authId);

                room.emitToUser(user.authId, "success", {
                    word: room.word.word,
                    score: score,
                });

                room.emit("successfulGuess", {
                    authId: user.authId,
                    score: actor.score,
                    artist: artist.score,
                });

                // Still send the message to the artist
                room.emitToUser(room.data.currentArtist, "chatMessage", {
                    authId: user.authId,
                    message: message,
                });

                // If everyone has guessed, advance the state
                if (room.data.actors.every(i =>
                         i.successful || i.afk || i.authId === room.data.currentArtist
                    )
                ) {
                    this.setState("result");
                }

                return true;
            }
            else if (fit === 1) {
                // Almost guess

                room.emitToUser(user.authId, "almost", {
                    almost: message,
                });

                // Still send the message to the artist
                room.emitToUser(room.data.currentArtist, "chatMessage", {
                    authId: user.authId,
                    message: message,
                });

                return true;
            }

            return false;
        }
    }

    static checkWord(guess, wordObj) {
        if (wordObj.wordFormat) {
            if (wordObj.matcher.test(guess))
                return 2;

            if (wordObj.close.filter(i => i.test(guess)).length)
                return 1;

            return 0;
        }
        else {
            for (let r of wordObj.regex) {
                if (r.test(guess)) return 2;
            }

            for (let r of wordObj.prefix) {
                if (r.test(guess)) return 1;
            }

            return 0;
        }
    }

    static regexify(word, prefix?) {
        word = word.toLowerCase();

        var buf;
        if (prefix) {
            buf = "";
            let counter = 0;
            for (let l of word) {
                buf += l;
                if (/\w/.test(l))
                    if (++counter >= 4) break;
            }
        }
        else {
            buf = word;
        }

        return new RegExp(
            buf.replace(/[^a-zA-Z0-9 ]/gi, "\\W*")
            .replace(/ /g, " *"), "i");
    }

    static wordFormat(data) {
        let parts = data.split(";");
        let word = parts[0];
        let matcher = parts.length > 1 ? parts[1] : word;

        matcher = matcher.split(" ").filter(i => i.length);
        let matchRegex: any = [];
        let words: any[] = [];

        for (let w of matcher) {
            let inner = w.slice(1, -1);
            switch (w[0]) {
                case "(":
                case "[":
                    let possibilities = inner.split("|").map(escapeRegex).map(i => i.replace("'", "\\W*"));
                    matchRegex.push("(" + possibilities.join("|") + ")" +
                        (w[0] == "[" ? "?" : ""));

                    possibilities = possibilities.filter(significantWord);
                    if (possibilities.length) {
                        words.push(new RegExp("(" +
                            possibilities.filter(significantWord).join("|") +
                            ")", "i"));
                    }
                    break;
                case "%":
                    matchRegex.push("(" + wildCards[w].join("|") + ")");
                    break;
                default:
                    matchRegex.push(escapeRegex(w));
                    if (significantWord(w)) {
                        words.push(new RegExp(escapeRegex(w).replace("'", "\\W*"), "i"));
                    }
                    break;
            }
        }

        matchRegex = new RegExp(matchRegex.map(i => i.replace("'", "\\W*")).join("\\W*"), "i");

        return {
            wordFormat: true,
            word: word,
            matcher: matchRegex,
            close: words,
        };
    }

    toggleAFK(actor) {
        var room = this.room;

        if (actor.afk) {
            actor.afk = false;

            // add back to the drawing queue
            this.addActiveActor(actor);  // Passing an actor instead of a user here
            // Shouldn't matter
        }
        else {
            actor.afk = true;
            this.removeActiveActor(actor);
        }

        room.emit("afk", { authId: actor.authId, afk: actor.afk });
    }

    join(user) {
        super.join(user);
        this.addActiveActor(user);
    }

    addActiveActor(user) {
        // Remember if this method is changed to use properties of user objects
        // it will break
        var room = this.room;

        if (room.drawQueue.indexOf(user.authId) === -1) {
            room.drawQueue.splice(room.queueIndex, 0, user.authId);
            room.queueIndex = (room.queueIndex + 1) % room.drawQueue.length;

            if (room.data.actors.filter(i => !i.afk).length === 2) {
                this.startGame();
            }
        }
    }

    removeActiveActor(actor) {
        // see note in addActor
        var room = this.room;

        var guessedIndex = room.data.guessed.indexOf(actor.authId);
        if (guessedIndex > -1) {
            room.data.guessed.splice(guessedIndex, 1);
        }

        var index = room.drawQueue.indexOf(actor.authId);
        if (index > -1) {
            room.drawQueue.splice(index, 1);

            if (room.data.actors.filter(i => !i.afk).length === 0) {
                return; // Hang tight
            }
            else if (room.data.actors.filter(i => !i.afk).length === 1) {
                this.setState("waiting");
                return;
            }
            else if (index < room.queueIndex) {
                room.queueIndex--;
            }
            else if (index == room.queueIndex) {
                room.queueIndex--; // Offset for advanceTurn

                if (room.data.state === "drawing") {
                    room.data.rounds--;
                    room.data.drawings.pop();

                    room.emit("skip", { reason: "leave", wwi: room.word.word });

                    this.setState("drawing");
                }
                else if (room.data.state === "guessed") {
                    room.emit("skip", { reason: "leave", wwi: room.word.word });

                    this.setState("result");
                }
            }
        }

        // If this makes it so that everyone left has guessed,
        // Then end the round
        if (["drawing", "guessed"].indexOf(room.data.state) > -1 &&
            room.data.actors.every(i =>
                 i.successful || i.afk || i.authId === room.data.currentArtist
            )
        ) {
            this.setState("result");
        }

    }

    leave(actor) {
        super.leave(actor);

        this.removeActiveActor(actor);
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
        room.data.drawings = [];
        room.data.currentDrawing = null;

        room.data.rounds = 0;
    }

    clearAllTimeouts() {
        for (var i in this.timeouts) {
            clearTimeout(this.timeouts[i]);
        }
        this.timeouts = {};
    }

    deconstruct() {
        super.deconstruct();

        this.clearAllTimeouts();
    }
}

export default SketchRoom;
