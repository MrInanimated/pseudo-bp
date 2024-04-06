/* jshint node: true*/
/* jshint esnext: true*/
"use strict";

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

var
    roomSet = {},
    alphabet = "abcdefghijklmnopqrstuvwxyz",
    removeDiacritics = require("../diacritics.js"),

    allowedCustomization = {
        heart: ["default", "bar", "hexagon"],
        colors: ["defaultColor", "red", "orange", "yellow", "green", "turquoise", "blue", "purple", "pink"],
    },

    lockedPresets = {
        vowels: "aeiou",
        classic: "abcdefghijlmnopqrstuv",
        full: "abcdefghijklmnopqrstuvwxyz",
        scrabble: "a9b2c2d4e12f2g3h2i9jkl4m2n6o8p2qr6s4t6u4v2w2xy2z",
    },

    BPRoom = module.exports = function (room) {
    this.room = room;
    room.type = "regular";
    roomSet[room.name] = this;

    this.dictionaries = room.externals.dictionaries;

    // Add a bunch of data variables to the parent data object
    // (the parent data object is sent to all sockets on connection)
    var data = {
        actors: [],
        activePlayerIndex: 0,
        state: "waiting",
        prompt: "",

        currentRoundSettings: {
            dictionary: "normal",
            minimumBombTimer: 5000,
            lockedLetters: lockedPresets.full,
            startingLives: 2,
            maxLives: 3,
            promptDifficulty: 1,
            minPromptLength: 2,
            maxPromptLength: 3,
            changePromptOnDeath: "no",
            victoryCondition: "last",
        },

        wordCount: 0,
        roundStart: 0,
        lastExplosion: 0,
    };
    data.nextRoundSettings = extend({}, data.currentRoundSettings);
    extend(this.room.data, data);

    room.actorsByAuthId = {};

    this.nextExplosion = 0;
    this.failedCounter = 0;
    this.currentDict = {};
};

/* Utility methods */
BPRoom.prototype.newDictionary = function () {
    var dictionaryFactory;

    var room = this.room;

    switch (room.data.currentRoundSettings.dictionary) {
        case "normal":
            dictionaryFactory = this.dictionaries.en.Normal;
            break;
        case "jqxz":
            dictionaryFactory = this.dictionaries.en.JQXZ;
            break;
        case "ness":
            dictionaryFactory = this.dictionaries.en.Ness;
            break;
        case "classic":
            dictionaryFactory = this.dictionaries["en-CL"].Normal;
            break;
        case "bombparty":
            dictionaryFactory = this.dictionaries["en-BP"].Normal;
            break;
        case "unique":
            dictionaryFactory = this.dictionaries.unique.Unique;
            break;
        case "markov":
            dictionaryFactory = this.dictionaries.markov.Normal;
            break;
        case "single":
            dictionaryFactory = this.dictionaries.en.Single;
            break;
    }

    this.currentDict = dictionaryFactory.newDict();
    // Add other dictionaries later
};

BPRoom.prototype.generatePrompt = function () {
    //console.time("generatePrompt");
    var prompt = this.currentDict.generatePrompt(
        this.room.data.currentRoundSettings.minPromptLength,
        this.room.data.currentRoundSettings.maxPromptLength,
        this.room.data.currentRoundSettings.promptDifficulty);
    // I'm not a fan of these verbose variable names
    //console.timeEnd("generatePrompt");
    return prompt;
};

BPRoom.prototype.useWord = function (word) {
    this.currentDict.useWord(word);
};

BPRoom.prototype.checkWord = function (word) {
    // Easter egg
    if (this.room.name.toLowerCase() === "sphenopalatineganglioneuralgia") {
        return word.indexOf(this.room.data.prompt) > -1;
    }

    if (word === "sphenopalatine ganglioneuralgia" &&
        this.room.data.currentRoundSettings.dictionary === "normal" &&
        word.indexOf(this.room.data.prompt) > -1) {
        if (this.currentDict.usedWords && this.currentDict.usedWords[word]) {
            return false;
        }
        return true;
    }

    if (word === "hexjingle" &&
        this.room.data.currentRoundSettings.dictionary === "normal" &&
        word.indexOf(this.room.data.prompt) > -1) {
        if (this.currentDict.usedWords && this.currentDict.usedWords[word]) {
            return false;
        }
        return true;
    }

    return this.currentDict.checkWord(word) && word.indexOf(this.room.data.prompt) > -1;
};

BPRoom.prototype.scoreWord = function (word, prompt) {
    if (word === "sphenopalatine ganglioneuralgia") {
        return -1000;
    }

    if (this.currentDict.scoreWord) {
        return this.currentDict.scoreWord(word, prompt);
    }
    else {
        return 0;
    }
};

BPRoom.prototype.addUser = function (socket, user) {
    var room = this.room;
    var game = this;

    // setWord listener
    socket.on("setWord", function (e) {
        // This function is significantly less indented than the one it's replacing
        // It's still pretty bad though

        // Check the state is correct and that it's this user's turn
        if (room.data.state !== "playing") return;
        if (room.data.actors[room.data.activePlayerIndex].authId !== user.authId) return;

        // Check that e.word exists, and that e.word is a string
        if (!e.word || typeof e.word !== "string") return;

        // Emit setword to everybody and set actor.lastWord to this
        var actor = room.actorsByAuthId[user.authId];
        var word = removeDiacritics(e.word.toLowerCase()).trim();

        room.emit("setWord", {
            authId: user.authId,
            word: word,
        });

        actor.lastWord = word;

        // If e.validate is true, they pressed enter and we should check the word
        if (e.validate) {
            // Check that the word is valid
            if (game.checkWord(word)) {
                // use the word, then emit winWord to everybody
                game.useWord(word);

                var wordScore = game.scoreWord(word, room.data.prompt);

                room.emit("winWord", {
                    authId: user.authId,
                    word: word,
                    score: wordScore,
                });

                actor.lastWinWord = word;
                actor.lastWord = "";
                actor.lastPrompt = room.data.prompt;
                actor.wordsUsed++;
                actor.score += wordScore;

                room.data.wordCount++;

                // Dealing with the alphabet counter
                if (word[0] === alphabet[actor.alphapos.current]) {
                    actor.alphapos.current++;
                    if (actor.alphapos.current >= alphabet.length) {
                        actor.alphapos.current = 0;
                        actor.alphapos.rounds++;
                    }
                }

                // Dealing with flips
                for (var l of word) {
                    if (actor.lockedLetters[l]) {
                        actor.lockedLetters[l] = Math.max(
                            0, actor.lockedLetters[l] - 1);
                    }
                }

                // Check for a flip
                var allUsed = true;
                for (var i in actor.lockedLetters) {
                    if (actor.lockedLetters[i] > 0) {
                        allUsed = false;
                        break;
                    }
                }

                if (allUsed) {
                    if (actor.lives === room.data.currentRoundSettings.maxLives)
                        actor.uflips++;
                    actor.flips++;

                    actor.lives = Math.min(
                        room.data.currentRoundSettings.maxLives, actor.lives + 1);

                    room.emit("setLives", {
                        authId: actor.authId,
                        lives: actor.lives,
                    });

                    game.regenLockedLetters(actor);
                }

                // Advance the turn if the game hasn't ended
                var winner = game.checkEndGame();
                if (winner) {
                    game.endGame(winner);
                }
                else {
                    game.advanceTurn();
                }
            }
            else {
                room.emit("failWord", {
                    authId: user.authId,
                    word: word,
                });
            }
        }

    });

    // skipTurn listener
    socket.on("skipTurn", function () {
        if (room.data.state !== "playing") return;
        if (room.data.actors[room.data.activePlayerIndex].authId !== user.authId) return;

        // Be careful with the timeouts
        clearTimeout(room.timeouts.bombTimeout);
        game.explode();

    });

    // join listener
    socket.on("join", function () {
        if (room.data.state !== "waiting" && room.data.state !== "starting") return;
        if (room.data.actors.length >= 32) return;  // Raised limit to 32 players
        // I really should stop using magic numbers
        // Put this at the top in a config file some time?

        // If the player is already in the game, return
        if (room.actorsByAuthId[user.authId]) return;

        var actor = {
            displayName: user.displayName,
            authId: user.authId,
            profileImage: user.profileImage,

            isAlive: true,
            lastWord: "",
            lastWinWord: "",
            lastPrompt: "",

            wordsUsed: 0,
            flips: 0,
            uflips: 0,
            deaths: 0,
            score: 0,
            alphapos: {
                current: 0,
                rounds: 0,
            },

            customization: user.customization || {
                heart: "default",
                heartColor: "defaultColor",
                progressBarColor: "defaultColor",
                promptColor: "defaultColor",
            },
        };

        room.data.actors.push(actor);
        room.actorsByAuthId[user.authId] = actor;

        room.emit("addActor", actor);

        room.debug("Actor added.");

        if (room.data.state !== "starting")
            game.setState("starting");

    });

    // startGame listener
    socket.on("startGame", function () {
        if (room.data.state !== "starting") return;
        if (!room.data.actors[0] || room.data.actors[0].authId !== user.authId) return;

        game.setState("playing");
    });

    // leave listener
    socket.on("leave", function() {
        if (room.actorsByAuthId[user.authId]) {
            game.leave(room.actorsByAuthId[user.authId]);
        }
    });

    // dictionary listener
    socket.on("dictionary", function (e) {
        if (!room.canChange(user)) return;
        if (["normal", "jqxz", "ness", "classic", "bombparty", "unique", "markov", "single"].indexOf(e) === -1) return;

        if (room.data.nextRoundSettings.dictionary === e)  return;

        room.data.nextRoundSettings.dictionary = e;
        room.emit("dictionary", e);
    });

    // minimumBombTimer listener
    socket.on("minimumBombTimer", function (e) {
        if (!room.canChange(user)) return;

        e = parseInt(e);

        if (isNaN(e)) return;
        if (e < 0 || e > 30000) return;
        if (room.data.nextRoundSettings.minimumBombTimer === e) return;

        room.data.nextRoundSettings.minimumBombTimer = e;
        room.emit("minimumBombTimer", e);
    });

    // maxLives listener
    socket.on("maxLives", function (e) {
        if (!room.canChange(user)) return;

        e = parseInt(e);

        if (isNaN(e)) return;
        if (e < 1 || e > 8) return;
        if (e % 1 !== 0) return;

        // A weird thing here

        // Starting lives must be less than or equal to maxLives
        // Unless the victory condition is maxLives, then maxLives must
        // be at least two and startingLives must be less than or equal to
        // maxLives - 1

        var subtract = 0;
        if (room.data.nextRoundSettings.victoryCondition === "maxLives"){
            e = Math.max(2, e);
            subtract = 1;
        }

        if (room.data.nextRoundSettings.maxLives !== e) {
            room.data.nextRoundSettings.maxLives = e;

            room.data.nextRoundSettings.startingLives =
                Math.min(room.data.nextRoundSettings.maxLives - subtract,
                    room.data.nextRoundSettings.startingLives);
            room.emit("maxLives", e);
        }
    });

    // promptDifficulty listener
    socket.on("promptDifficulty", function (e) {
        if (!room.canChange(user)) return;

        e = parseInt(e);

        if (isNaN(e)) return;
        if (e < 0 || e > 3) return;
        if (e % 1 !== 0) return;
        if (room.data.nextRoundSettings.promptDifficulty === e) return;

        room.data.nextRoundSettings.promptDifficulty = e;

        room.emit("promptDifficulty", e);

    });

    // maxPromptLength listener
    socket.on("maxPromptLength", function (e) {
        if (!room.canChange(user)) return;

        e = parseInt(e);

        if (isNaN(e)) return;
        if (e < 1 || e > 5) return;
        if (e % 1 !== 0) return;
        if (room.data.nextRoundSettings.maxPromptLength === e) return;

        room.data.nextRoundSettings.maxPromptLength = e;
        room.data.nextRoundSettings.minPromptLength = Math.min(
            room.data.nextRoundSettings.minPromptLength, e);

        room.emit("maxPromptLength", e);
    });

    // minPromptLength listener
    socket.on("minPromptLength", function (e) {
        if (!room.canChange(user)) return;

        e = parseInt(e);
        if (isNaN(e)) return;
        if (e < 1 || e > 5) return;
        if (e % 1 !== 0) return;
        if (room.data.nextRoundSettings.minPromptLength === e) return;

        room.data.nextRoundSettings.minPromptLength = e;
        room.data.nextRoundSettings.maxPromptLength = Math.max(
            room.data.nextRoundSettings.maxPromptLength, e);

        room.emit("minPromptLength", e);

    });

    // bonusLetter listener
    socket.on("bonusLetters", function (e) {
        if (!room.canChange(user)) return;
        if (["special:random", "special:randomscrabble"].indexOf(e) === -1 && !parseLockedLetters(e)) return;
        if (room.data.nextRoundSettings.lockedLetters === e) return;

        room.data.nextRoundSettings.lockedLetters = e;
        room.emit("bonusLetters", e);
    });

    // startingLives listener
    socket.on("startingLives", function (e) {
        if (!room.canChange(user)) return;

        e = parseInt(e);

        if (isNaN(e)) return;
        if (e < 1 || e > 8) return;
        if (e % 1 !== 0) return;

        // See the maxLives listener for an explanation to this madness
        var subtract = room.data.nextRoundSettings.victoryCondition === "maxLives" ? 1 : 0;
        e = Math.min(e, room.data.nextRoundSettings.maxLives - subtract);

        if (room.data.nextRoundSettings.startingLives !== e) {
            room.data.nextRoundSettings.startingLives = e;
            room.emit("startingLives", e);
        }
    });

    // changePromptOnDeath listener
    socket.on("changePromptOnDeath", function (e) {
        if (!room.canChange(user)) return;
        if (e !== "no") {
            e = Number(e);
            if (isNaN(e)) return;
            if (e < 1) return;
            if (e % 1 !== 0) return;
        }

        if (room.data.nextRoundSettings.changePromptOnDeath !== e) {
            room.data.nextRoundSettings.changePromptOnDeath = e;
            room.emit("changePromptOnDeath", e);
        }
    });

    // victoryCondition listener
    socket.on("victoryCondition", function (e) {
        if (!room.canChange(user)) return;
        if (["last", "maxLives"].indexOf(e) === -1) return;

        if (room.data.nextRoundSettings.victoryCondition !== e) {
            room.data.nextRoundSettings.victoryCondition = e;

            // See the maxLives listener for an explanation to this madness
            if (e === "maxLives") {
                room.data.nextRoundSettings.maxLives = Math.max(
                    room.data.nextRoundSettings.maxLives, 2);
                room.data.nextRoundSettings.startingLives = Math.min(
                    room.data.nextRoundSettings.maxLives - 1,
                    room.data.nextRoundSettings.startingLives);
            }

            room.emit("victoryCondition", e);
        }
    });

    // customization listener
    socket.on("customization", function (e) {
        user.customization = user.customization || {};

        if (allowedCustomization.heart.indexOf(e.heart) > -1) {
            user.customization.heart = e.heart;
        }
        else {
            user.customization.heart = "default";
        }

        for (var i of ["heartColor", "progressBarColor", "promptColor"]) {
            if (allowedCustomization.colors.indexOf(e[i]) > -1) {
                user.customization[i] = e[i];
            }
            else {
                user.customization[i] = "defaultColor";
            }
        }

    });
};

BPRoom.prototype.removeUser = function (socket) {
    var room = this.room;

    if (room.actorsByAuthId[socket.authId]) {
        this.leave(room.actorsByAuthId[socket.authId]);
    }
};

BPRoom.prototype.leave = function (actor) {
    var room = this.room;

    var index = room.data.actors.indexOf(actor);

    room.emit("removeActor", { authId: actor.authId });

    // If the game hasn't started, remove the user from the actors
    if (room.data.state === "waiting" || room.data.state === "starting") {
        room.data.actors.splice(index, 1);
        delete room.actorsByAuthId[actor.authId];

        // If this makes it so that there are no players, revert to waiting state
        if (!room.data.actors.length) {
            this.setState("waiting");
        }
    }
    // Otherwise, just set isAlive to be false
    else {
        actor.isAlive = false;
        actor.lastWord = "";
        room.emit("setWord", {
            authId: actor.authId,
            word: "",
        });

        // Check if this means the game ends
        var winner = this.checkEndGame();
        if (winner) {
            this.endGame(winner);
            return;
        }

        // Also, if it's this player's turn, advance the turn
        if (room.data.actors[room.data.activePlayerIndex].authId === actor.authId) {
            this.advanceTurn(true);
        }
    }

};

// All state changes must go through this
BPRoom.prototype.setState = function (newState) {
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
            // There used to be time out code here for dealing with starting the game
            // Now there isn't
            break;
        case "playing":
            // Copy the round settings
            room.data.currentRoundSettings = extend({}, room.data.nextRoundSettings);

            this.startGame();
            break;
    }
    room.debug("Switching state to " + newState);
};

// advanceTurn function
// failed is true if the person prior failed the prompt
BPRoom.prototype.advanceTurn = function (failed) {
    var room = this.room;

    if (room.data.state === "playing") {
        if (failed) {
            this.failedCounter++;
        }
        else {
            this.failedCounter = 0;
        }

        // If the person prior didn't fail the prompt, or
        // If the number of turns since the last successful word is a multiple of
        // the change prompt on death setting
        var changePrompt = (!failed
            || (
                room.data.currentRoundSettings.changePromptOnDeath !== "no"
                && this.failedCounter % room.data.currentRoundSettings.changePromptOnDeath === 0
            ));
        if (changePrompt) {
            // change the prompt
            room.data.prompt = this.generatePrompt();
            room.emit("setPrompt", room.data.prompt);
        }

        // Find the next player in line
        for (var i = (room.data.activePlayerIndex + 1) % room.data.actors.length;
                i !== room.data.activePlayerIndex;
                i = (i + 1) % room.data.actors.length) {
            if (room.data.actors[i].isAlive) {
                room.data.activePlayerIndex = i;
                break;
            }
        }

        // The for loop's ability to fail to find a new valid player is deliberate
        // so it supports single player games too
        room.emit("setActivePlayerIndex", room.data.activePlayerIndex);

        // Deal with minimum timers
        if (room.timeouts.bombTimeout && this.nextExplosion) {
            var timeLeft = this.nextExplosion - Date.now();
            if (timeLeft < room.data.currentRoundSettings.minimumBombTimer) {
                clearTimeout(room.timeouts.bombTimeout);
                room.timeouts.bombTimeout = setTimeout(this.explode.bind(this),
                    room.data.currentRoundSettings.minimumBombTimer);
                this.nextExplosion =
                    room.data.currentRoundSettings.minimumBombTimer + Date.now();
            }
        }
    }
};

// Function to determine what time the bombs have
BPRoom.prototype.newBombTime = function () {
    // Currently a random time between 10 and 20 seconds
    // Probably will hook up to a config file later
    return 10000 + 20000 * Math.random() << 0;
};

BPRoom.prototype.startGame = function () {
    var room = this.room;

    this.newDictionary();

    room.data.roundStart = Date.now();
    room.data.lastExplosion = room.data.roundStart;

    // Set up initial actor conditions
    for (var i in room.actorsByAuthId) {
        var actor = room.actorsByAuthId[i];
        this.regenLockedLetters(actor);
        actor.lives = room.data.currentRoundSettings.startingLives;
    }

    // Set the activePlayerIndex to be a random number
    room.data.activePlayerIndex = Math.random() * room.data.actors.length << 0;

    var nextTime = this.newBombTime();
    room.timeouts.bombTimeout = setTimeout(this.explode.bind(this), nextTime);
    this.nextExplosion = Date.now() + nextTime;

    // Do an initial advance
    this.advanceTurn();
};

function parseLockedLetters(lockedString) {
    var lockedLetters = {};
    // Check the format is correct
    if (!/^([a-z]\d*)+$/.test(lockedString)) {
        return false;
    }

    var regex = /([a-z])(\d*)/g;
    var match = regex.exec(lockedString);
    while (match !== null) {
        var letter = match[1];
        var number = match[2].length ? +match[2] : 1;
        if (number === 0) {
            return false;
        }
        if (lockedLetters[letter]) {
            return false;
        }
        lockedLetters[letter] = number;

        match = regex.exec(lockedString);
    }

    return lockedLetters;
}

BPRoom.prototype.regenLockedLetters = function (actor) {
    var room = this.room;

    if (room.data.currentRoundSettings.lockedLetters === "special:random") {
        // Let's re-implement Fisher-Yates here, why not
        var alphaList = alphabet.split("");
        var i = alphaList.length;
        var min = alphaList.length - 18;  // 18 is the number of letters in the random set

        while (i-- > min) {
            var index = Math.floor((i + 1) * Math.random());
            var temp = alphaList[index];
            alphaList[index] = alphaList[i];
            alphaList[i] = temp;
        }

        var letters = alphaList.slice(min);
        letters.sort();
        room.emit("setBonusLetters", {
            authId: actor.authId,
            letters: letters,
        });

        actor.randomLetters = letters;
        actor.lockedLetters = frequency(letters);
    }
    else if (room.data.currentRoundSettings.lockedLetters === "special:randomscrabble") {
        var scrabbleLetters = {};
        for (var l of alphabet) {
            scrabbleLetters[l] = 0;
        }

        for (var j = 0; j < 100; j++) {
            scrabbleLetters[alphabet[Math.random() * alphabet.length | 0]]++;
        }

        room.emit("setBonusLetters", {
            authId: actor.authId,
            letters: scrabbleLetters,
        });

        actor.lockedLetters = scrabbleLetters;
    }
    else {
        var lockedLetters = parseLockedLetters(room.data.currentRoundSettings.lockedLetters);
        actor.lockedLetters = extend({}, lockedLetters);
    }

};

// Explode function
// This is called when, surprisingly, the bomb explodes
// This function sets a time out on itself, so be careful
// You may need to clean it up if you're doing something tricky with this
BPRoom.prototype.explode = function () {
    var room = this.room;

    if (room.data.state === "playing") {
        room.data.lastExplosion = Date.now();

        // Take a life away from the current player
        var actor = room.data.actors[room.data.activePlayerIndex];
        actor.lives--;
        actor.lastWinWord = "";
        actor.lastWord = "";
        actor.deaths++;
        room.emit("setLives", {
            authId: actor.authId,
            lives: actor.lives,
        });

        // If the current player has no lives, set isAlive to false
        if (actor.lives <= 0) {
            actor.isAlive = false;
        }

        // Check for if the game has ended, and advance a turn if not
        var winner = this.checkEndGame();
        if (winner) {
            this.endGame(winner);
        }
        else {
            var nextTime = this.newBombTime();
            room.timeouts.bombTimeout = setTimeout(this.explode.bind(this), nextTime);
            this.nextExplosion = Date.now() + nextTime;

            this.advanceTurn(true);
        }
    }
};

BPRoom.prototype.checkEndGame = function () {
    var room = this.room;

    var alive = room.data.actors.filter(function (a) {
        return a.isAlive;
    });

    // Don't end the game if it's singleplayer
    if (alive.length <= 1 && room.data.actors.length !== 1 || alive.length === 0) {
        return { winner: alive[0] };
    }
    else {
        var criteria = function () {
            return false;
        };

        switch (room.data.currentRoundSettings.victoryCondition) {
            case "maxLives":
                criteria = function (a) {
                    return a.lives === room.data.currentRoundSettings.maxLives;
                };
                break;
        }

        var satisfied = room.data.actors.filter(criteria);
        if (satisfied.length >= 1) {
            return { winner: satisfied[0] };
        }
        else {
            return false;
        }

    }
};

BPRoom.prototype.endGame = function (winner) {
    var room = this.room;

    var elapsedTime = Date.now() - room.data.roundStart;
    room.emit("endGame", {
        authId: winner.winner ? winner.winner.authId : undefined,
        time: elapsedTime,
    });

    this.cleanUp();
    this.setState("waiting");
};

BPRoom.prototype.cleanUp = function () {
    var room = this.room;

    // delete all the actors
    room.data.actors = [];
    room.actorsByAuthId = {};

    // reset the activePlayerIndex
    room.data.activePlayerIndex = 0;

    room.data.wordCount = 0;
    this.failedCounter = 0;

    // clear the bomb timeout if there is one
    if (room.timeouts.bombTimeout) {
        clearTimeout(room.timeouts.bombTimeout);
        delete room.timeouts.bombTimeout;
    }
};

BPRoom.prototype.deconstruct = function () {
    var room = this.room;
    delete roomSet[room.name];

    if (room.timeouts.bombTimeout) {
        clearTimeout(room.timeOuts.bombTimeout);
    }
};

function sanitiseString(str) {
    return str.toLowerCase().replace(/[^a-zA-Z]+/g, "");
}

BPRoom.prototype.onChatMessage = function (user, message) {
    if (message.startsWith("!")) {
        var args = message.slice(1).split(" ");
        // if (args[0] == "c" || args[0] == "cheat" || args[0] == "lookup") {
        //     if (user.role < 1) {
        //         return;
        //     }

        //     var query = {
        //         number: 20,
        //         prompts: [],
        //         id: this.room.name,
        //     };

        //     var dictionaryValue;
        //     if (this.room.data.state == "playing") {
        //         dictionaryValue = this.room.data.currentRoundSettings.dictionary;
        //     }
        //     else {
        //         dictionaryValue = this.room.data.nextRoundSettings.dictionary;
        //     }

        //     switch (dictionaryValue) {
        //         case "classic":
        //             query.dictionary = "en-CL";
        //             break;
        //         case "bombparty":
        //         case "unique":
        //             query.dictionary = "en-BP";
        //             break;
        //         case "markov":
        //             query.dictionary = "markov";
        //             break;
        //         default:
        //             query.dictionary = "en";
        //             break;
        //     }

        //     var in_args = true;
        //     var num;
        //     for (var i = 1; i < args.length; i++) {
        //         if (args[i][0] == "-")
        //             in_args = false;

        //         if (args[i] == "-num" || args[i] == "-n") {
        //             num = parseInt(args[i+1]);
        //             if (!isNaN(num)) query.number = num;
        //         }
        //         else if (args[i] == "-begin" || args[i] == "-b") {
        //             if (args[i+1]) query.begins = sanitiseString(args[i+1]);
        //         }
        //         else if (args[i] == "-end" || args[i] == "-e") {
        //             if (args[i+1]) query.ends = sanitiseString(args[i+1]);
        //         }
        //         else if (args[i] == "-minlen") {
        //             num = parseInt(args[i+1]);
        //             if (!isNaN(num)) query.minLength = num;
        //         }
        //         else if (args[i] == "-maxlen") {
        //             num = parseInt(args[i+1]);
        //             if (!isNaN(num)) query.maxLength = num;
        //         }
        //         /*
        //         else if (args[i] == "-r") {
        //             try {
        //                 new RegExp(args[i+1]);
        //                 query.regex = args[i+1];
        //             }
        //             catch (e) {
        //                 setTimeout(() =>
        //                     this.room.emit("serverMessage",
        //                         "Invalid regular expression."), 0);
        //                 return;
        //             }
        //         }
        //         */
        //         else if (args[i] == "-lang" || args[i] == "-l") {
        //             switch (args[i+1]) {
        //                 case "classic":
        //                 case "cl":
        //                     query.dictionary = "en-CL";
        //                     break;
        //                 case "bombparty":
        //                 case "bp":
        //                     query.dictionary = "en-BP";
        //                     break;
        //                 case "markov":
        //                 case "mk":
        //                     query.dictionary = "markov";
        //                     break;
        //                 case "en":
        //                 case "english":
        //                 case "pseudo":
        //                     query.dictionary = "en";
        //                     break;
        //                 default:
        //                     break;
        //             }
        //         }
        //         else if (in_args) {
        //             query.prompts.push(sanitiseString(args[i]));
        //         }
        //     }

        //     sendQuery(query);
        // }
    }
};

// BPRoom.prototype.sendCheat = function (results) {
//     var room = this.room;
//     var message;
//     if (results.words.length) {
//         message = "Possible: " + results.words.join(" ");
//         if (results.number > results.words.length) {
//             message += " ..." + (results.number - results.words.length) + " more.";
//         }
//     }
//     else {
//         message = "No words found.";
//     }
//     room.emit("serverMessage", message);
// };

// var redis = require("redis");

// var redisConfig = require("../config/redis.js");
// var pubClient = redis.createClient(
//     redisConfig.port, redisConfig.host, redisConfig.options
// );
// var subClient = redis.createClient(
//     redisConfig.port, redisConfig.host, redisConfig.options
// );

// function sendQuery(query) {
//     pubClient.publish("dictionary-query", JSON.stringify(query));
// }

// subClient.on("message", function (channel, message) {
//     if (channel == "dictionary-results") {
//         var results = JSON.parse(message);
//         if (roomSet[results.id]) {
//             roomSet[results.id].sendCheat(results.data);
//         }
//     }
// });

// subClient.subscribe("dictionary-results");
