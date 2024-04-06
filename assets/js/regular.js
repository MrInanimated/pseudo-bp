(function () {

window.game = {};

var alphabet = "abcdefghijklmnopqrstuvwxyz";

var frequency = function (list) {
    var freqs = {};
    for (var i = 0; i < list.length; i++) {
        if (freqs[list[i]] === undefined)
            freqs[list[i]] = 0;
        freqs[list[i]]++;
    }
    return freqs;
};

game.lockedPresets = {
    vowels: "aeiou",
    classic: "abcdefghijlmnopqrstuv",
    full: "abcdefghijklmnopqrstuvwxyz",
    scrabble: "a9b2c2d4e12f2g3h2i9jkl4m2n6o8p2qr6s4t6u4v2w2xy2z",
    random: "special:random",
    randomscrabble: "special:randomscrabble",
};

game.readCustomizationData = function () {
    room.user.customization = {};
    room.user.customization.heart = localStorage.customHeart || "default";
    room.user.customization.heartColor = localStorage.customHeartColor || "defaultColor";
    room.user.customization.progressBarColor = localStorage.customProgressBarColor || "defaultColor";
    room.user.customization.promptColor = localStorage.customPromptColor || "defaultColor";

    room.socket.emit("customization", room.user.customization);
};

var joinGameButton = document.getElementById("JoinGameButton");
var joinGameContainer = document.getElementById("JoinGameContainer");
var startGameButton = document.getElementById("StartGameButton");
var startGameContainer = document.getElementById("StartGameContainer");
var wordInputContainer = document.getElementById("WordInputContainer");
var wordInput = document.getElementById("WordInput");
var skipButton = document.getElementById("GlennButton");

game.onRoomData = function () {
    game.readCustomizationData();

    room.actorsByAuthId = {};

    for (var i = 0; i < room.data.actors.length; i++) {
        var actor = room.data.actors[i];
        room.actorsByAuthId[actor.authId] = actor;
        drawing.addActorElement(actor.authId, true);
    }

    drawing.recalculateActorElementPositions();

    if (room.data.state !== "playing") {
        if (!room.actorsByAuthId[room.user.authId]) {
            joinGameContainer.style.display = "";
        }

        wordInputContainer.style.display = "none";

        if (room.data.state === "starting" && room.data.actors[0] &&
            room.data.actors[0].authId === room.user.authId) {
            startGameContainer.style.display = "";
        }
    }
    else {
        drawing.startTicking();
        drawing.startBomb();
        drawing.mainElement.classList.add("Playing");
        wordInputContainer.style.display = "";

        drawing.rotateArrow(2 * Math.PI *
            room.data.activePlayerIndex / room.data.actors.length);

        drawing.makeLockedLetters();
        game.remakeScoreboard();
    }

    drawing.updateStatusText();
};

game.init = function () {
    joinGameButton.addEventListener("click", function (e) {
        room.socket.emit("join");
    });

    startGameButton.addEventListener("click", function (e) {
        room.socket.emit("startGame");
    });

    wordInput.addEventListener("paste", function (e) {
        wordInput.value = "Please don't copy-paste :D";
        e.preventDefault();
    });

    wordInput.addEventListener("keyup", function (e) {
        if (room.data.state === "playing" &&
            room.data.actors[room.data.activePlayerIndex] &&
            room.data.actors[room.data.activePlayerIndex].authId === room.user.authId) {
            room.socket.emit("setWord", {
                word: wordInput.value,
                validate: false,
            });
        }
    });

    wordInput.addEventListener("keydown", function (e) {
        if (room.data.state === "playing" &&
            room.data.actors[room.data.activePlayerIndex] &&
            room.data.actors[room.data.activePlayerIndex].authId === room.user.authId) {
            if (e.keyCode === 13 && wordInput.value) {
                e.preventDefault();
                room.socket.emit("setWord", {
                    word: wordInput.value,
                    validate: true,
                });
                wordInput.value = "";
            }
        }
    });

    skipButton.addEventListener("click", function (e) {
        if (room.data.actors[room.data.activePlayerIndex] &&
            room.data.actors[room.data.activePlayerIndex].authId === room.user.authId) {
            room.socket.emit("skipTurn");
        }
    });

    document.getElementById("GameContainer").addEventListener("click", function (e) {
        wordInput.focus();
    });

    // addActor listener
    room.socket.on("addActor", function (actor) {
        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;

        drawing.addActorElement(actor.authId);
        drawing.updateStatusText();

        // Check if the user that just joined is the current user
        // and hide the join game button if so
        if (actor.authId === room.user.authId) {
            joinGameContainer.style.display = "none";
        }
    });

    // removeActor listener
    room.socket.on("removeActor", function (event) {
        var authId = event.authId;
        var actor = room.actorsByAuthId[authId];
        var index = room.data.actors.indexOf(actor);
        if (room.data.state === "playing") {
            actor.isAlive = false;
            drawing.actorElemsByAuthId[authId].element.classList.add("Dead");
            game.killScoreboardPlayer(authId);
        }
        else {
            room.data.actors.splice(index, 1);
            delete room.actorsByAuthId[authId];

            drawing.removeActorElement(authId);
            drawing.updateStatusText();

            // Check if the user that just left is the current user
            // And show the join game container in that case
            if (authId === room.user.authId) {
                joinGameContainer.style.display = "";
            }

            // Check if the user leaving meant that the current user
            // can start the game
            if (room.data.state === "starting" && room.data.actors[0] &&
                room.data.actors[0].authId === room.user.authId) {
                startGameContainer.style.display = "";
            }
            else {
                startGameContainer.style.display = "none";
            }
        }
    });

    // setState listener
    room.socket.on("setState", function (newState) {
        room.data.state = newState;
        if (newState === "playing") {
            room.data.lastExplosion = Date.now() + room.serverOffset;
            room.data.roundStart = room.data.lastExplosion;
            room.data.wordCount = 0;
            drawing.startTicking();
            drawing.startBomb();

            joinGameContainer.style.display = "none";
            startGameContainer.style.display = "none";
            wordInputContainer.style.display = "";

            room.data.currentRoundSettings = {};
            for (var i in room.data.nextRoundSettings) {
                room.data.currentRoundSettings[i] =
                    room.data.nextRoundSettings[i];
            }

            for (var j in room.actorsByAuthId) {
                var actor = room.actorsByAuthId[j];
                game.regenLockedLetters(actor);
                actor.lives = room.data.currentRoundSettings.startingLives;
                drawing.actorElemsByAuthId[j].lives.innerHTML =
                    drawing.makeLives(actor.lives, room.data.currentRoundSettings.maxLives,
                        actor.customization);
            }

            drawing.mainElement.classList.add("Playing");

            drawing.makeLockedLetters();
            game.remakeScoreboard();
        }
        else {
            wordInputContainer.style.display = "none";

            if (room.data.state === "starting" && room.data.actors[0] &&
                room.data.actors[0].authId === room.user.authId) {
                startGameContainer.style.display = "";
            }

            drawing.mainElement.classList.remove("Playing");

        }

        drawing.updateStatusText();
    });

    // setActivePlayerIndex listener
    var focusNext = false;
    room.socket.on("setActivePlayerIndex", function (index) {
        room.data.activePlayerIndex = index;

        wordInput.value = "";

        if (focusNext) {
            focusNext = false;
            setTimeout(function () {
                if (!room.data.actors.length ||
                    room.data.actors[room.data.activePlayerIndex].authId !== room.user.authId) {
                    document.getElementById("ChatInput").focus();
                }
            }, 400);
        }

        // Do something with it if it's your turn
        if (room.data.actors[index].authId === room.user.authId) {
            wordInputContainer.classList.remove("Hidden");
            wordInput.focus();

            // Play the sound for your turn
            audio.playSound("myTurn");
            focusNext = true;
        }
        else {
            wordInputContainer.classList.add("Hidden");
        }

        for (var i in drawing.actorElemsByAuthId) {
            if (i === room.data.actors[index].authId) {
                drawing.actorElemsByAuthId[i].element.classList.add("Active");
                drawing.actorElemsByAuthId[i].lastWord.innerHTML = "";
            }
            else {
                drawing.actorElemsByAuthId[i].element.classList.remove("Active");
            }
        }

        drawing.rotateArrow(2 * Math.PI * index / room.data.actors.length);
        drawing.updateStatusText();
    });

    // setPrompt listener
    room.socket.on("setPrompt", function (prompt) {
        room.data.prompt = prompt;
        drawing.updateStatusText();
    });

    // setWord listener
    room.socket.on("setWord", function (event) {
        room.actorsByAuthId[event.authId].lastWord = event.word;

        drawing.highlightPrompt(drawing.actorElemsByAuthId[event.authId].lastWord,
            event.word, room.data.prompt);
    });

    // winWord listener
    room.socket.on("winWord", function (event) {
        var actor = room.actorsByAuthId[event.authId];
        actor.lastWinWord = event.word;
        actor.lastWord = "";
        actor.lastPrompt = room.data.prompt;
        actor.wordsUsed++;
        actor.score += event.score;
        game.updateScoreboard(actor.authId, "score", event.score);

        wordCountElement.innerHTML = ++room.data.wordCount;

        // Deal with alphabet counter
        if (event.word[0] === alphabet[actor.alphapos.current]) {
            actor.alphapos.current++;
            if (actor.alphapos.current >= alphabet.length) {
                actor.alphapos.current = 0;
                actor.alphapos.rounds++;
            }
            game.updateScoreboard(actor.authId, "alpha");
        }

        game.updateScoreboard(actor.authId, "wordsUsed");

        drawing.highlightPrompt(drawing.actorElemsByAuthId[event.authId].lastWord,
            event.word, room.data.prompt);

        drawing.actorElemsByAuthId[event.authId].applyAnimation("Shake0");
        audio.playSound("winWord");

        for (var i = 0; i < event.word.length; i++) {
            var letter = event.word[i];

            if (actor.lockedLetters[letter]) {
                actor.lockedLetters[letter] = Math.max(
                    0, actor.lockedLetters[letter] - 1);
            }

            var total = game.lockedTotal(room.data.currentRoundSettings.lockedLetters);
            var unused = total;
            for (var l in actor.lockedLetters) {
                unused -= actor.lockedLetters[l];
            }

            drawing.actorElemsByAuthId[actor.authId].lettersBar.style.height =
                unused / total * 100 + "%";
        }

        // manage locked letters and their animations
        if (actor.authId === room.user.authId) {
            drawing.updateLockedLetters();
        }
    });

    // failWord listener
    room.socket.on("failWord", function (event) {
        // Do the failWord animation and sound
        var actor = room.actorsByAuthId[event.authId];
        drawing.actorElemsByAuthId[event.authId].applyAnimation("Shake1");
        audio.playSound("failWord");
    });

    // setLives listener
    room.socket.on("setLives", function (event) {
        var actor = room.actorsByAuthId[event.authId];
        if (event.lives > actor.lives ||
            event.lives === room.data.currentRoundSettings.maxLives) {
            // Do the flip animation
            drawing.actorElemsByAuthId[event.authId].applyAnimation("Spin");

            game.regenLockedLetters(actor);
            drawing.actorElemsByAuthId[event.authId].lettersBar.style.height = 0;

            if (actor.authId === room.user.authId && room.data.currentRoundSettings.lockedLetters !== "special:random") {
                drawing.resetLockedLetters();
            }

            if (event.lives === actor.lives)
                actor.uflips++;
            actor.flips++;

            game.updateScoreboard(actor.authId, "flips");
            game.updateScoreboard(actor.authId, "uflips");
        }
        else if (event.lives < actor.lives) {
            // Do the bomb animation
            actor.lastWinWord = "";
            actor.lastWord = "";

            drawing.actorElemsByAuthId[event.authId].applyAnimation("Shake2");
            audio.playSound("boom");

            room.data.lastExplosion = Date.now() + room.serverOffset;
            drawing.startBomb();

            drawing.actorElemsByAuthId[event.authId].lastWord.innerHTML = "";

            actor.deaths++;

            game.updateScoreboard(actor.authId, "deaths");
        }
        actor.lives = event.lives;

        drawing.updateLives(actor);

        if (actor.lives <= 0) {
            actor.isAlive = false;

            drawing.actorElemsByAuthId[event.authId].element.classList.add(
                "Dead");

            game.killScoreboardPlayer(actor.authId);

            if (actor.authId === room.user.authId) {
                lockedLettersContainer.classList.add("Hidden");
            }
        }
    });

    // setBonusLetters listener
    room.socket.on("setBonusLetters", function (event) {
        var actor = room.actorsByAuthId[event.authId];
        actor.lockedLetters = {};

        if (room.data.currentRoundSettings.lockedLetters === "special:random") {
            actor.randomLetters = event.letters;
            for (i = 0; i < event.letters.length; i++) {
                var l = event.letters[i];
                actor.lockedLetters[l] = 1;
            }
        }
        else if (room.data.currentRoundSettings.lockedLetters === "special:randomscrabble") {
            actor.lockedLetters = event.letters;
        }

        if (actor.authId === room.user.authId) {
            drawing.makeLockedLetters();
        }
    });

    // endGame listener
    room.socket.on("endGame", function (event) {
        var winnerAuthId = event.authId;
        var elapsedTime = event.time;
        room.data.lastWinner = room.actorsByAuthId[winnerAuthId];

        // If the current player is the winner play the win game sound
        // currently the myTurn sound because I haven't made one yet
        // so... TODO
        if (event.authId === room.user.authId) {
            audio.playSound("winGame");
        }

        joinGameContainer.style.display = "";
        wordInputContainer.classList.add("Hidden");

        if (focusNext) {
            focusNext = false;
            setTimeout(function () {
                document.getElementById("ChatInput").focus();
            }, 400);
        }

        game.stopElapsedTime();
        room.data.serverElapsed = event.time;
        elapsedTimeElement.innerHTML = game.getElapsedTime(event.time);

        // Cleanup
        room.data.activePlayerIndex = 0;
        room.data.actors = [];
        room.actorsByAuthId = {};
        drawing.stopTicking();
        drawing.stopBomb();

        drawing.actorsElement.innerHTML = "";
        drawing.actorElemsByAuthId = {};

        drawing.rotateArrow(0, true);
        lockedLettersContainer.classList.add("Hidden");
    });

    // dictionary listener
    room.socket.on("dictionary", function (dict) {
        room.data.nextRoundSettings.dictionary = dict;

        switch (dict) {
            case "normal":
                room.appendToChat("Info",
                    "For the next round, the standard English dictionary will be used.");
                break;
            case "jqxz":
                room.appendToChat("Info",
                    "For the next round, the dictionary will only accept English words containing J, Q, X, or Z.");
                break;
            case "ness":
                room.appendToChat("Info",
                    "For the next round, the dictionary will only accept English words containing \"ness\".");
                break;
            case "classic":
                room.appendToChat("Info",
                    "For the next round, the classic English BP dictionary will be used.");
                break;
            case "bombparty":
                room.appendToChat("Info",
                    "For the next round, the current English BP dictionary will be used.");
                break;
            case "unique":
                room.appendToChat("Info",
                    "For the next round, the dictionary will only give almost-unique prompts.");
                break;
            case "markov":
                room.appendToChat("Info",
                    "For the next round, the dictionary will be completely made up.");
                break;
            case "single":
                room.appendToChat("Info",
                    "For the next round, the dictionary will only use one prompt for the entire round.");
                break;
        }

        room.updateSettingsTab();
    });

    // minimumBombTimer listener
    room.socket.on("minimumBombTimer", function (time) {
        room.data.nextRoundSettings.minimumBombTimer = time;
        room.appendToChat("Info",
            "The minimum bomb timer for the next round will be " + time / 1000 +
            " second" + (time === 1000 ? "" : "s") + ".");

        room.updateSettingsTab();
    });

    // maxLives listener
    room.socket.on("maxLives", function (lives) {
        room.data.nextRoundSettings.maxLives = lives;
        room.data.nextRoundSettings.startingLives =
            Math.min(room.data.nextRoundSettings.maxLives -
                (room.data.nextRoundSettings.victoryCondition === "maxLives" ? 1 : 0),
                room.data.nextRoundSettings.startingLives);

        room.appendToChat("Info",
            "The maximum lives for the next round will be " + lives + " li" +
            (lives === 1 ? "fe" : "ves") + ".");

        room.updateSettingsTab();
    });

    // startingLives listener
    room.socket.on("startingLives", function (lives) {
        room.data.nextRoundSettings.startingLives = lives;
        room.appendToChat("Info",
            "The starting lives for the next round will be " + lives + " li" +
            (lives === 1 ? "fe" : "ves") + ".");

        room.updateSettingsTab();
    });

    // promptDifficulty listener
    room.socket.on("promptDifficulty", function (difficulty) {
        room.data.nextRoundSettings.promptDifficulty = difficulty;

        var difficultyName = "normal";
        switch (difficulty) {
            case 0:
                difficultyName = "mild";
                break;
            case 1:
                difficultyName = "normal";
                break;
            case 2:
                difficultyName = "hard";
                break;
            case 3:
                difficultyName = "masochistic";
                break;
        }

        room.appendToChat("Info",
            "The prompt difficulty for the next round will be " +
            difficultyName + ".");

        room.updateSettingsTab();
    });

    // maxPromptLength listener
    room.socket.on("maxPromptLength", function (length) {
        room.data.nextRoundSettings.maxPromptLength = length;
        room.data.nextRoundSettings.minPromptLength = Math.min(length,
            room.data.nextRoundSettings.minPromptLength);
        room.appendToChat("Info",
            "The maximum prompt length for the next round will be " + length +
            " letters.");

        room.updateSettingsTab();
    });

    room.socket.on("minPromptLength", function (length) {
        room.data.nextRoundSettings.minPromptLength = length;
        room.data.nextRoundSettings.maxPromptLength = Math.max(length,
            room.data.nextRoundSettings.maxPromptLength);
        room.appendToChat("Info",
            "The minimum prompt length for the next round will be " + length +
            " letters.");

        room.updateSettingsTab();
    });

    // bonusLetters listener
    room.socket.on("bonusLetters", function (letters) {
        room.data.nextRoundSettings.lockedLetters = letters;
        var desc;

        switch (letters) {
            case game.lockedPresets.vowels:
                desc = "aeiou (Vowels)";
                break;
            case game.lockedPresets.classic:
                desc = "abcdefghijlmnopqrstuv (Classic)";
                break;
            case game.lockedPresets.full:
                desc = "abcdefghijklmnopqrstuvwxyz (Full)";
                break;
            case game.lockedPresets.scrabble:
                desc = "the letters in a <a href=\"https://en.wikipedia.org/wiki/Scrabble_letter_distributions#English\" target=\"_blank\" rel=\"noopener noreferrer\">Scrabble bag</a>";
                break;
            case game.lockedPresets.random:
                desc = "18 randomly picked letters";
                break;
            case game.lockedPresets.randomscrabble:
                desc = "100 randomly picked letters";
                break;
            default:
                desc = "some custom letters (see the settings)";
                break;
        }

        room.appendToChat("Info",
            "The set of letters needed for a life for the next round are " +
            desc + ".");

        room.updateSettingsTab();
    });

    // changePromptOnDeath listener
    room.socket.on("changePromptOnDeath", function (e) {
        room.data.nextRoundSettings.changePromptOnDeath = e;
        var desc;

        if (e === "no") {
            desc = "the prompt won't change when a player loses a life.";
        }
        else {
            var plural = e === 1 ? " has" : "s have";
            desc = "the prompt will change after " + e + " turn" + plural + " passed where nobody manages to solve the prompt.";
        }

        room.appendToChat("Info", "For the next round, " + desc);

        room.updateSettingsTab();
    });

    // victoryCondition listener
    room.socket.on("victoryCondition", function (e) {
        room.data.nextRoundSettings.victoryCondition = e;
        var desc;

        switch (e) {
            case "last":
                desc = "Last Man Standing.";
                break;
            case "maxLives":
                desc = "First to Max Lives.";
                break;
            default:
                break;
        }

        if (e === "maxLives") {
            room.data.nextRoundSettings.maxLives = Math.max(room.data.nextRoundSettings.maxLives, 2);
            room.data.nextRoundSettings.startingLives = Math.min(room.data.nextRoundSettings.startingLives, room.data.nextRoundSettings.maxLives - 1);
        }

        room.appendToChat("Info",
            "The win condition for the next round is now " + desc);

        room.updateSettingsTab();
    });

};

game.onDisconnected = function (disconnectReason) {
    room.data.state = "disconnected";

    switch (disconnectReason) {
        case "banned":
            drawing.updateStatusText({
                status1: "It looks like you've been banned.",
                status2: "Please be more respectful in the future",
            });
            break;
        case "kicked":
            drawing.updateStatusText({
                status1: "It looks like you've been kicked.",
                status2: "Please be more respectful in the future",
            });
            break;
        default:
            drawing.updateStatusText({
                status1: "Whoops, it looks like you disconnected.",
                status2: "Please refresh the page",
            });
            break;
    }

    drawing.stopTicking();
    drawing.stopBomb();
};

game.parseLockedLetters = function (lockedString) {
    var lockedLetters = {};
    // Check the format is correct
    if (!/^([a-z]\d*)+$/.test(lockedString)) {
        return {
            error: true,
            msg: "Incorrect format.",
        };
    }

    var regex = /([a-z])(\d*)/g;
    var match = regex.exec(lockedString);
    while (match !== null) {
        var letter = match[1];
        var number = match[2].length ? +match[2] : 1;
        if (number === 0) {
            return {
                error: true,
                msg: "You can't have 0 of a letter. (You have 0 of " + letter + ")",
            };
        }
        if (lockedLetters[letter]) {
            return {
                error: true,
                msg: "You can't have duplicate letters. (You have duplicates of " + letter + ")",
            };
        }
        lockedLetters[letter] = number;

        match = regex.exec(lockedString);
    }

    return lockedLetters;
};

game.regenLockedLetters = function (actor) {
    actor.lockedLetters = {};
    if (!room.data.currentRoundSettings.lockedLetters.match(/^special:/)) {
        var chosen = game.parseLockedLetters(room.data.currentRoundSettings.lockedLetters);
        if (chosen.error) {
            // This should pretty much never happen
            console.error("Invalid lockedLetter specifier (this shouldn't ever happen)");
        }

        for (var j in chosen) {
            actor.lockedLetters[j] = chosen[j];
        }

    }
};

game.initiateSettingsTab = function () {
    var setupButtons = function (blockName, eventName, controlFunction) {
        var control = document.getElementById(blockName);
        var buttons = control.getElementsByTagName("a");
        controlFunction = controlFunction || function (e) {
            if (room.user.role >= roles.host) {
                room.socket.emit(eventName, this.dataset.value);
            }
        };
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener("click", controlFunction);
        }
    };

    setupButtons("DictionaryControl", "dictionary");
    setupButtons("MaxLivesControl", "maxLives");
    setupButtons("StartingLivesControl", "startingLives");
    setupButtons("PromptDifficultyControl", "promptDifficulty");
    setupButtons("MinimumPromptLengthControl", "minPromptLength");
    setupButtons("MaximumPromptLengthControl", "maxPromptLength");
    setupButtons("VictoryConditionControl", "victoryCondition");

    setupButtons("HeartControl", null, function (e) {
        localStorage.customHeart = this.dataset.value;
        game.readCustomizationData();
        room.updateSettingsTab();
    });

    setupButtons("HeartColorControl", null, function (e) {
        localStorage.customHeartColor = this.dataset.value;
        game.readCustomizationData();
        room.updateSettingsTab();
    });

    setupButtons("ProgressBarColorControl", null, function (e) {
        localStorage.customProgressBarColor = this.dataset.value;
        game.readCustomizationData();
        room.updateSettingsTab();
    });

    setupButtons("PromptColorControl", null, function (e) {
        localStorage.customPromptColor = this.dataset.value;
        game.readCustomizationData();
        room.updateSettingsTab();
    });

    function setupInput(elementId, eventName, validate, parse) {
        var input = document.getElementById(elementId);
        input.addEventListener("change", function (e) {
            if (validate(input.value)) {
                room.socket.emit(eventName, parse(input.value));
            }
            else {
                game.updateSettingsTab();
            }
        });

        input.addEventListener("input", function (e) {
            if (validate(input.value)) {
                input.classList.remove("Error");
                input.classList.add("Success");
            }
            else {
                input.classList.add("Error");
                input.classList.remove("Success");
            }
        });
    }

    setupInput(
        "MinimumBombTimerInput",
        "minimumBombTimer",
        function (value) {
            value = Number(value);
            return value >= 0 && value <= 30;
        },
        function (value) {
            value = Number(value);
            return value * 1000 | 0;
        });

    setupButtons("BonusLettersPresetsControl", null, function (e) {
        var input = document.getElementById("BonusLetterInput");
        input.value = game.lockedPresets[this.dataset.value];
        input.dispatchEvent(new Event("change"));
    });

    var bonusLetterInput = document.getElementById("BonusLetterInput");
    var bonusStatus = document.getElementById("BonusLetterInputStatus");
    bonusLetterInput.addEventListener("input", function (e) {
        if (this.value === "special:random" ||
            this.value === "special:randomscrabble") {
            bonusStatus.textContent = "Okay!";
            bonusLetterInput.classList.remove("Error");
            bonusLetterInput.classList.add("Success");
        }

        var ll = game.parseLockedLetters(this.value);
        if (ll.error) {
            bonusStatus.textContent = ll.msg;
            bonusLetterInput.classList.add("Error");
            bonusLetterInput.classList.remove("Success");
        }
        else {
            bonusStatus.textContent = "Okay!";
            bonusLetterInput.classList.remove("Error");
            bonusLetterInput.classList.add("Success");
        }
    });

    bonusLetterInput.addEventListener("change", function () {
        if (this.value === "special:random" ||
            this.value === "special:randomscrabble") {
            room.socket.emit("bonusLetters", this.value);
        }

        var ll = game.parseLockedLetters(this.value);
        if (!ll.error) {
            room.socket.emit("bonusLetters", this.value);
        }
    });

    setupInput(
        "ChangePromptOnDeathInput",
        "changePromptOnDeath",
        function (value) {
            if (value === "no") {
                return true;
            }
            else {
                value = Number(value);
                return value >= 1 && value % 1 === 0;
            }
        },
        function (value) {
            if (value === "no") {
                return "no";
            }
            else {
                value = Number(value);
                return value;
            }
        });
};

game.updateSettingsTab = function () {
    var canModify = room.user.role >= roles.host;

    var i, j;

    var unmodifiableControls = [
        "DictionaryControl",
        "MinimumBombTimerControl",
        "MaxLivesControl",
        "StartingLivesControl",
        "PromptDifficultyControl",
        "MinimumPromptLengthControl",
        "MaximumPromptLengthControl",
        "BonusLettersPresetsControl",
        "VictoryConditionControl",
    ].map(document.getElementById, document);

    for (i = 0; i < unmodifiableControls.length; i++) {
        unmodifiableControls[i].classList[canModify ? "remove" : "add"](
            "Disabled");
    }

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

    highlightValue("DictionaryControl",
        room.data.nextRoundSettings.dictionary);
    highlightValue("MinimumBombTimerControl",
        room.data.nextRoundSettings.minimumBombTimer);
    highlightValue("MaxLivesControl",
        room.data.nextRoundSettings.maxLives);
    highlightValue("StartingLivesControl",
        room.data.nextRoundSettings.startingLives);
    highlightValue("PromptDifficultyControl",
        room.data.nextRoundSettings.promptDifficulty);
    highlightValue("MinimumPromptLengthControl",
        room.data.nextRoundSettings.minPromptLength);
    highlightValue("MaximumPromptLengthControl",
        room.data.nextRoundSettings.maxPromptLength);
    highlightValue("BonusLettersControl",
        room.data.nextRoundSettings.lockedLetters);
    highlightValue("ChangePromptOnDeathControl",
        room.data.nextRoundSettings.changePromptOnDeath);
    highlightValue("VictoryConditionControl",
        room.data.nextRoundSettings.victoryCondition);

    var minimumBombTimerInput = document.getElementById("MinimumBombTimerInput");
    minimumBombTimerInput.value = +(Math.round(room.data.nextRoundSettings.minimumBombTimer / 1000 + "e+3") + "e-3");
    minimumBombTimerInput.disabled = !canModify;
    minimumBombTimerInput.classList.remove("Success");
    minimumBombTimerInput.classList.remove("Error");

    var bonusLetterInput = document.getElementById("BonusLetterInput");
    bonusLetterInput.value = room.data.nextRoundSettings.lockedLetters;
    bonusLetterInput.disabled = !canModify;
    bonusLetterInput.classList.remove("Success");
    bonusLetterInput.classList.remove("Error");

    var changePromptOnDeathInput = document.getElementById("ChangePromptOnDeathInput");
    changePromptOnDeathInput.value = "" + room.data.nextRoundSettings.changePromptOnDeath;
    changePromptOnDeathInput.disabled = !canModify;
    changePromptOnDeathInput.classList.remove("Success");
    changePromptOnDeathInput.classList.remove("Error");

    highlightValue("HeartControl", localStorage.customHeart);
    highlightValue("HeartColorControl", localStorage.customHeartColor);
    highlightValue("ProgressBarColorControl", localStorage.customProgressBarColor);
    highlightValue("PromptColorControl", localStorage.customPromptColor);

    /* update the example player */
    var examplePlayer = document.getElementById("ExamplePlayer");

    var hearts = examplePlayer.querySelectorAll(".HeartContainer");
    var progressBar = examplePlayer.querySelector(".LettersLeftBar");
    var lastWordContainer = examplePlayer.querySelector(".LastWordContainer");

    for (i = 0; i < hearts.length; i++) {
        if (hearts[i].classList.contains("Full"))
            hearts[i].className = "HeartContainer Full";
        else
            hearts[i].className = "HeartContainer";
        hearts[i].classList.add(room.user.customization.heart);
        hearts[i].classList.add(room.user.customization.heartColor);
    }

    progressBar.className = "LettersLeftBar";
    progressBar.classList.add(room.user.customization.progressBarColor);

    lastWordContainer.className = "LastWordContainer";
    lastWordContainer.classList.add(room.user.customization.promptColor);

};

/* Scoreboard Functions */
var scoreboard = document.getElementById("Scoreboard");
var elapsedTimeElement = document.getElementById("ElapsedTime");
var wordCountElement = document.getElementById("WordCount");
var scoreboardBody = document.getElementById("ScoreboardTableBody");
var scoreboardCollapse = document.getElementById("ScoreboardCollapse");

scoreboardCollapse.addEventListener("click", function () {
    room.checkAndScrollChat(function () {
        var icon = "<i class=\"fa fa-%{r}-square-o\"></i>";

        if (scoreboardBody.classList.contains("HideDead")) {
            scoreboardBody.classList.remove("HideDead");
            scoreboardCollapse.innerHTML =
                icon.replace("%{r}", "minus");
        }
        else {
            scoreboardBody.classList.add("HideDead");
            scoreboardCollapse.innerHTML =
                icon.replace("%{r}", "plus");
        }
    });
});

game.getElapsedTime = function (elapsedTime) {
    if (!elapsedTime)
        elapsedTime =
            Date.now() + room.serverOffset - room.data.roundStart;

    var seconds = Math.round(elapsedTime / 1000);
    var minutes = Math.floor(seconds / 60);
    seconds %= 60;

    seconds = seconds < 10 ? "0" + seconds : String(seconds);

    if (minutes >= 60) {
        var hours = Math.floor(minutes / 60);
        minutes %= 60;
        minutes = hours + ":" + (minutes < 10 ? "0" + minutes : minutes);
    }
    else
        minutes = minutes < 10 ? "0" + minutes : String(minutes);

    return minutes + ":" + seconds;
};

// Completely remake the scoreboard.
// Called upon a new game or a joining
// a started game
game.remakeScoreboard = function () {
    room.checkAndScrollChat(function () {
        scoreboardBody.innerHTML = "";

        wordCountElement.innerHTML = room.data.wordCount;
        elapsedTimeElement.innerHTML = game.getElapsedTime();


        for (var i = 0; i < room.data.actors.length; i++) {
            var actor = room.data.actors[i];

            var source = escapeHTML(actor.profileImage ?
                actor.profileImage : "/images/AvatarPlaceholder.png", true);

            // fetch identicon from gravatar if is guest
            if (actor.authId.indexOf("guest:") === 0) {
                source = drawing.getIdenticonSource(actor.authId);
            }

            var onerror = " onerror=\"if (this.src != '/images/AvatarPlaceholder.png') this.src = '/images/AvatarPlaceholder.png';\"";

            scoreboardBody.innerHTML += "<tr class=\"" +
                "scoreboard_" + escapeHTML(actor.authId.replace(":", "_"), !0) +
                (actor.isAlive ? "" : " Dead") +
                (actor.authId === room.user.authId ? " You" : "") +
                "\">" +
                "<td><img src=\"" + source + "\"" + onerror + "></img></td>" +
                "<td class=\"flips\">" + actor.flips + "</td>" +
                "<td class=\"uflips\">" + actor.uflips + "</td>" +
                "<td class=\"deaths\">" + actor.deaths + "</td>" +
                "<td class=\"wordsUsed\">" + actor.wordsUsed + "</td>" +
                "<td class=\"alpha\">" + actor.alphapos.rounds + "-" +
                alphabet[actor.alphapos.current].toUpperCase() + "</td>" +
                "<td class=\"score\">" + actor.score + "</td>" +
                "</tr>";
        }

        // So eh, I'm writing this before the window.drawing object is instantiated
        // But this should be fine because the below code should execute first... hopefully

        drawing.elapsedTimeInterval = setInterval(function () {
            elapsedTimeElement.innerHTML = game.getElapsedTime();
        }, 1000);
    });
};

game.stopElapsedTime = function () {
    if (drawing.elapsedTimeInterval)
        clearInterval(drawing.elapsedTimeInterval);
};

game.updateScoreboard = function (authId, valueName, score) {
    var scoreboardElement = document.querySelector(
        ".scoreboard_" + authId.replace(":", "_"));
    var actor = room.actorsByAuthId[authId];
    if (scoreboardElement && actor) {
        var valueElement = scoreboardElement.querySelector("." + valueName);
        if (valueElement) {
            switch (valueName) {
                case "flips":
                case "uflips":
                case "deaths":
                case "wordsUsed":
                    valueElement.innerHTML = actor[valueName];
                    break;
                case "alpha":
                    valueElement.innerHTML =
                        actor.alphapos.rounds + "-" +
                        alphabet[actor.alphapos.current].toUpperCase();
                    break;
                case "score":
                    valueElement.innerHTML = "" + actor.score + "(" + score + ")";
                    break;
                default:
                    break;
            }
        }
    }
};

// set the respective row's class to "Dead"
// So it can be greyed out and hidden if necessary
game.killScoreboardPlayer = function (authId) {
    var scoreboardElement = document.querySelector(
        ".scoreboard_" + authId.replace(":", "_"));
    scoreboardElement.classList.add("Dead");
};

game.lockedTotal = function () {
    switch (room.data.currentRoundSettings.lockedLetters) {
        case "special:random":
            return 18;
        case "special:randomscrabble":
            return 100;
        default:
            var ll = game.parseLockedLetters(room.data.currentRoundSettings.lockedLetters);
            var total = 0;
            for (var l in ll) {
                total += ll[l];
            }
            return total;
    }
};

/* Drawing Functions */

var requestAnimationFrame = window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    function (callback) { window.setTimeout(callback, 1000 / 60); };

window.drawing = {
    width: 800,
    radius: 350,
    arrowAngle: 0,

    bombTimeouts: [],

    actorElemsByAuthId: {},
    mainElement: document.getElementById("MainContainer"),
    actorsElement: document.getElementById("ActorContainer"),
    bombElement: document.getElementById("BombElement"),
    arrowElement: document.getElementById("ArrowElement"),
    statusElement: document.getElementById("StatusContainer"),

    // audio stuff
    tickSourcce: null,
    tickTimeout: null,
};

// Resize the main drawing zone if necessary
// Adding a throttle event to prevent resize from firing too much
var throttle = function (type, name, obj) {
    obj = obj || window;
    var running = false;
    var func = function () {
        if (running) return;
        running = true;
        requestAnimationFrame(function () {
            obj.dispatchEvent(new CustomEvent(name));
            running = false;
        });
    };
    obj.addEventListener(type, func);
};
throttle("resize", "optimizedResize");

drawing.resizeGame = function () {
    var container = drawing.mainElement;
    var parent = container.parentNode;

    var lockedLetters = document.getElementById("LockedLettersContainer");

    var lockedLettersScale = Math.min(
        parent.clientHeight / lockedLetters.clientHeight, 1);

    var lockedLettersWidth = lockedLettersScale * lockedLetters.clientWidth;

    lockedLetters.style.transform = "scale(" + lockedLettersScale + ")";

    var scale = Math.min(
        (parent.clientWidth - 2 * lockedLettersWidth) / drawing.width,
        parent.clientHeight / drawing.width,
        1);
    document.getElementById("MainContainer").style.transform =
        "scale(" + scale + ")";
};
window.addEventListener("optimizedResize", drawing.resizeGame);
window.dispatchEvent(new CustomEvent("optimizedResize"));

var actorContainer = document.getElementById("ActorContainer");
drawing.recalculateActorElementPositions = function () {
    for (var i = 0; i < room.data.actors.length; i++) {
        var angle = 2 * i * Math.PI / room.data.actors.length;
        var dx = drawing.radius * Math.cos(angle);
        var dy = drawing.radius * Math.sin(angle);

        var actorElement = document.getElementById(
            "actor_" + room.data.actors[i].authId.replace(":", "_"));
        actorElement.style.left = drawing.width / 2 + dx - 50 + "px";
        actorElement.style.top = drawing.width / 2 + dy - 50 + "px";
    }
};

drawing.getIdenticonSource = function (authId) {
    var guestNum = parseInt(authId.split(":")[1]);
    return "https://www.gravatar.com/avatar/" +
        guestNum.toString(16) +
        "?s=48&f=y&d=identicon";
};

drawing.addActorElement = function (authId, queue) {
    if (drawing.actorElemsByAuthId[authId]) return;

    var actor = room.actorsByAuthId[authId];

    var actorElement = document.createElement("DIV");
    actorElement.id = "actor_" + authId.replace(":", "_");
    actorElement.className = actor.isAlive ? "" : "Dead";

    var source = escapeHTML(actor.profileImage ?
        actor.profileImage : "/images/AvatarPlaceholder.png", true);

    // fetch identicon from gravatar if is guest
    if (authId.indexOf("guest:") === 0) {
        source = drawing.getIdenticonSource(authId);
    }

    var total, unused;
    if (room.data.state === "playing") {
        total = game.lockedTotal(room.data.currentRoundSettings.lockedLetters);
        unused = total;
        for (var l in actor.lockedLetters) {
            unused -= actor.lockedLetters[l];
        }
    }

    var onerror = " onerror=\"if (this.src != '/images/AvatarPlaceholder.png') this.src = '/images/AvatarPlaceholder.png';\"";

    actorElement.innerHTML = "<div class=\"MainActorContainer\">" +
        "<img class=\"ProfilePicture\" src=\"" + source + "\"" + onerror + "></img>" +
        "<div class=\"TopContainer\">" +
        "<span class=\"NameContainer\">" +
        escapeHTML(actor.displayName) +
        "</span>" +
        "<div class=\"LivesContainer\">" +
        drawing.makeLives(actor.lives,
            room.data.currentRoundSettings.maxLives,
            actor.customization) +
        "</div>" +
        "</div>" +
        "<div class=\"LastWordContainer " +
        escapeHTML(actor.customization.promptColor, true) +
        "\"></div>" +
        "<div class=\"LettersLeft\">" +
        "<div class=\"LettersLeftBar " +
        escapeHTML(actor.customization.progressBarColor, true) +
        "\"" +
        (room.data.state === "playing" ? " style=\"height:" + unused / total * 100 + "%\"" : "") +
        "></div>" +
        "</div>" +
        "</div>";

    actorContainer.appendChild(actorElement);

    var animClasses = [
        "Shake0",
        "Shake1",
        "Shake2",
        "Spin",
    ];

    drawing.actorElemsByAuthId[authId] = {
        element: actorElement,
        lives: actorElement.querySelector(".LivesContainer"),
        lastWord: actorElement.querySelector(".LastWordContainer"),
        lettersBar: actorElement.querySelector(".LettersLeftBar"),
        applyAnimation: function (animClass) {
            if (animClasses.indexOf(animClass) === -1) return;

            for (var i = 0; i < animClasses.length; i++) {
                this.element.classList.remove(animClasses[i]);
            }

            // Trigger a reflow
            this.element.offsetWidth = this.element.offsetWidth;

            this.element.classList.add(animClass);
        },
    };

    if (!queue)
        drawing.recalculateActorElementPositions();
};

drawing.removeActorElement = function (authId) {
    if (drawing.actorElemsByAuthId[authId]) {
        var elem = drawing.actorElemsByAuthId[authId].element;
        actorContainer.removeChild(elem);
        delete drawing.actorElemsByAuthId[authId];

        drawing.recalculateActorElementPositions();
    }
};

drawing.makeLives = function (lives, maxLives, customization) {
    var HTML = "";
    for (var i = 0; i < maxLives; i++) {
        HTML += "<span class=\"HeartContainer" +
            (i < lives ? " Full" : "") +
            " " + escapeHTML(customization.heart, true) +
            " " + escapeHTML(customization.heartColor, true) +
            "\"></span>";
    }
    return HTML;
};

drawing.updateLives = function (actor) {
    var lives = drawing.actorElemsByAuthId[actor.authId].lives.querySelectorAll(".HeartContainer");
    for (var i = 0; i < lives.length; i++) {
        if (i < actor.lives) {
            lives[i].classList.add("Full");
        }
        else {
            lives[i].classList.remove("Full");
        }
    }
};

drawing.updateStatusText = function (disconnectReason) {
    var HTML;
    if (room.data.state === "waiting") {
        HTML = "Waiting for some players...";

        if (room.data.lastWinner) {
            HTML += "<span class=\"Prompt\">" +
                escapeHTML(room.data.lastWinner.displayName) +
                " won the last round!</span>";
        }
    }
    else if (room.data.state === "starting") {
        HTML = "A new round will begin shortly...";

        if (room.data.lastWinner) {
            HTML += "<span class=\"Prompt\">" +
                escapeHTML(room.data.lastWinner.displayName) +
                " won the last round!</span>";
        }
    }
    else if (room.data.state === "playing") {
        var actor = room.data.actors[room.data.activePlayerIndex];
        if (actor.authId === room.user.authId) {
            HTML = "Quick! Type";
        }
        else {
            HTML = escapeHTML(actor.displayName) + ", type";
        }

        HTML += " ";

        switch (room.data.currentRoundSettings.dictionary) {
            case "normal":
                HTML += "an English word";
                break;
            case "jqxz":
                HTML += "an English word containing J, Q, X, or Z, also";
                break;
            case "ness":
                HTML += "an English word containing &quot;ness&quot;, also";
                break;
            case "classic":
                HTML += "an English word";
                break;
            case "single":
            default:
                HTML += "an English word";
                break;
        }

        HTML += " containing:";

        HTML += "<span class=\"Prompt\">" +
            escapeHTML(room.data.prompt).toUpperCase() +
            "</span>";
    }
    else if (room.data.state === "disconnected") {
        HTML = disconnectReason.status1;
        HTML += "<span class=\"Prompt\">" + disconnectReason.status2 +
            "</span>";
    }
    else {
        HTML = "Connecting...";
    }

    drawing.statusElement.innerHTML = HTML;
};

drawing.sanitiseAngle = function (angle) {
    angle %= 2 * Math.PI;
    if (angle <= -Math.PI) {
        angle += 2 * Math.PI;
    }
    else if (angle > Math.PI) {
        angle -= 2 * Math.PI;
    }
    return angle;
};

drawing.rotateArrow = function (angle, reset) {
    var newAngle;
    if (reset) {
        newAngle = 0;
    }
    else {
        newAngle = drawing.arrowAngle +
            drawing.sanitiseAngle(angle - drawing.arrowAngle);
    }
    drawing.arrowAngle = newAngle;

    drawing.arrowElement.style.transform =
        drawing.arrowElement.style.WebkitTransform =
        drawing.arrowElement.style.MsTransform =
        "rotate(" + newAngle + "rad)";

    if (angle > 0 && angle < Math.PI)
        drawing.statusElement.classList.add("Top");
    else
        drawing.statusElement.classList.remove("Top");
};

drawing.highlightPrompt = function (element, word, prompt) {
    var index = word.indexOf(prompt);
    var HTML = "";
    if (index > -1) {
        HTML = escapeHTML(word.slice(0, index).toUpperCase());
        HTML += "<span class=\"Highlight\">" +
            escapeHTML(
                word.slice(
                    index, index + prompt.length).toUpperCase()) +
            "</span>";
        HTML += escapeHTML(
            word.slice(index + prompt.length).toUpperCase());
    }
    else {
        HTML = escapeHTML(word.toUpperCase());
    }

    element.innerHTML = HTML;
};

var lockedLettersContainer = document.getElementById(
    "LockedLettersContainer");
drawing.makeLockedLetters = function () {
    lockedLettersContainer.innerHTML = "";
    lockedLettersContainer.classList.remove("Hidden");

    if (room.actorsByAuthId[room.user.authId]) {
        var HTML = "";
        var actor = room.actorsByAuthId[room.user.authId];

        // Determine if the locked letters require numbers
        var requireNumbers = false;
        if (room.data.currentRoundSettings.lockedLetters === "special:randomscrabble") {
            requireNumbers = true;
        }
        else if (!room.data.currentRoundSettings.lockedLetters.match(/^special:/)) {
            var ll = game.parseLockedLetters(room.data.currentRoundSettings.lockedLetters);
            for (var l in ll) {
                if (ll[l] > 1) {
                    requireNumbers = true;
                    break;
                }
            }
        }

        var colCounter = 0;
        var lockedLetters;
        if (room.data.currentRoundSettings.lockedLetters === "special:random" ||
            room.data.currentRoundSettings.lockedLetters === "special:randomscrabble") {
            lockedLetters = alphabet;
        }
        else {
            lockedLetters = room.data.currentRoundSettings.lockedLetters;
            lockedLetters = lockedLetters.replace(/[^a-z]/g, "");
            lockedLetters = lockedLetters.split("");
            lockedLetters.sort();
        }

        for (var i = 0; i < lockedLetters.length; i++) {
            if (!colCounter) HTML += "<tr>";

            HTML += "<td>";
            HTML += "<div id=\"locked_" +
                escapeHTML(lockedLetters[i], true) +
                "\" class=\"LockedLetter" +
                (!actor.lockedLetters[lockedLetters[i]] ? " Used" : "") +
                "\">" +
                escapeHTML(lockedLetters[i].toUpperCase());

            if (requireNumbers) {
                HTML += "<span class=\"LockedNumber\">" +
                    actor.lockedLetters[lockedLetters[i]] +
                    "</span>";
            }

            HTML += "</div></td>";

            if (colCounter) HTML += "</tr>";

            colCounter = !colCounter;
        }

        if (colCounter) HTML += "</tr>";

        lockedLettersContainer.innerHTML = HTML;
    }

    drawing.resizeGame();
};

drawing.updateLockedLetters = function () {
    if (room.actorsByAuthId[room.user.authId]) {
        var left = room.actorsByAuthId[room.user.authId].lockedLetters;

        for (var i in left) {
            var element = document.getElementById("locked_" + i);
            if (element) {
                if (left[i]) {
                    element.classList.remove("Used");
                }
                else {
                    element.classList.add("Used");
                }

                var number = element.querySelector(".LockedNumber");
                if (number) {
                    number.innerHTML = left[i];
                }
            }
            else {
                console.log("LockedLetter " + i + " not found");
            }
        }

    }
};

drawing.resetLockedLetters = function () {
    var lockedLetters = game.parseLockedLetters(room.data.currentRoundSettings.lockedLetters);
    for (var i in lockedLetters) {
        var element = document.getElementById("locked_" + i);
        if (element) {
            element.classList.remove("Used");

            var number = element.querySelector(".LockedNumber");
            if (number) {
                number.innerHTML = lockedLetters[i];
            }
        }
    }
};

drawing.clearBombAnims = function () {
    var bombAnims = ["Bomb1", "Bomb2", "Bomb3", "Bomb4", "Bomb5"];
    for (var i = 0; i < bombAnims.length; i++) {
        drawing.bombElement.classList.remove(bombAnims[i]);
    }
};

drawing.stopBomb = function () {
    drawing.clearBombAnims();

    if (drawing.tickSource) {
        drawing.tickSource.playbackRate.value = 1;
    }

    for (var j = 0; j < drawing.bombTimeouts.length; j++) {
        clearTimeout(drawing.bombTimeouts[j]);
    }

    if (drawing.bombInterval)
        clearInterval(drawing.bombInterval);

    drawing.bombTimeouts = [];
};

drawing.startBomb = function () {
    drawing.stopBomb();

    var easeOutQuad = function (t, b, c, d) {
        return -c * (t /= d) * (t - 2) + b;
    };

    var rates = {
        10000: { animClass: "Bomb2", rate: 1.1 },
        30000: { animClass: "Bomb3", rate: 1.5 },
        60000: { animClass: "Bomb4", rate: 2.5 },
        180000: { animClass: "Bomb5", rate: 5 },
    };

    drawing.bombElement.classList.add("Bomb1");

    var changeBomb = function (animClass, rate) {
        drawing.clearBombAnims();
        drawing.bombElement.classList.add(animClass);
    };

    for (var i in rates) {
        drawing.bombTimeouts.push(
            setTimeout(changeBomb, i, rates[i].animClass, rates[i].rate));
    }

    var startTime = Date.now();
    drawing.bombInterval = setInterval(function () {
        if (drawing.tickSource) {
            var time = Date.now() - startTime;
            if (time > 600000) {
                drawing.tickSource.playbackRate.value = 5;
            }
            else {
                drawing.tickSource.playbackRate.value =
                    easeOutQuad(time, 1, 4, 600000);
            }
        }
    }, 1000);

};

/* Audio Functions */
drawing.loadSounds = function () {
    var sounds = {
        tick: "/sounds/tick.wav",
        boom: "/sounds/boom.wav",
        failWord: "/sounds/failWord.wav",
        winWord: "/sounds/winWord.wav",
        winGame: "/sounds/winGame.wav",
        myTurn: "/sounds/myTurn.wav",
    };
    var i;
    if (app.room.toLowerCase() === "blackfish") {
        for (i in sounds) {
            sounds[i] = sounds[i].replace("/sounds/", "/sounds/blackfish/");
        }
    }

    for (i in sounds) {
        audio.loadSound(i, sounds[i]);
    }
};

drawing.startTicking = function () {
    if (drawing.tickTimeout)
        drawing.tickTimeout = null;
    drawing.tickSource = audio.playSound("tick", {
        loop: true,
    });
    if (!drawing.tickSource)
        drawing.tickTimeout = setTimeout(drawing.startTicking, 1000);
};

drawing.stopTicking = function () {
    if (drawing.tickSource)
        drawing.tickSource.stop(0);
    if (drawing.tickTimeout) {
        clearTimeout(drawing.tickTimeout);
        drawing.tickTimeout = null;
    }
};

drawing.loadSounds();

/* Shortcuts setup */

// Skip turn
Mousetrap.bind(["alt+k", "escape"], function () {
    if (room.data.state === "playing" &&
        room.data.actors[room.data.activePlayerIndex].authId === room.user.authId) {
        room.socket.emit("skipTurn");
    }
    return false;
});

// Switch to game input box
Mousetrap.bind("alt+g", function () {
    wordInput.focus();
    return false;
});

// Join/Start game
Mousetrap.bind("alt+j", function () {
    if (room.data.state === "waiting" || room.data.state === "starting") {
        if (room.actorsByAuthId[room.user.authId]) {
            if (room.data.actors[0].authId === room.user.authId) {
                room.socket.emit("startGame");
            }
        }
        else {
            room.socket.emit("join");
        }
    }
    return false;
});

})();
