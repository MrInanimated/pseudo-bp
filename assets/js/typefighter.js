(function () {

window.game = {};

var joinGameButton = document.getElementById("JoinGameButton");
var joinGameContainer = document.getElementById("JoinGameContainer");
var startGameButton = document.getElementById("StartGameButton");
var startGameContainer = document.getElementById("StartGameContainer");
var wordInputContainer = document.getElementById("WordInputContainer");
var wordInput = document.getElementById("WordInput");

game.onRoomData = function () {
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
        drawing.mainElement.classList.add("Playing");

        wordInputContainer.style.display = "";
        if (room.actorsByAuthId[room.user.authId]) {
            wordInputContainer.classList.remove("Hidden");
        }

        game.remakeScoreboard();
    }

    drawing.updateStatusText();
    drawing.redrawPrompts();
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
            room.actorsByAuthId[room.user.authId] &&
            room.actorsByAuthId[room.user.authId].isAlive) {
            room.socket.emit("setWord", {
                word: wordInput.value,
                validate: false,
            });
        }
    });

    wordInput.addEventListener("keydown", function (e) {
        if (room.data.state === "playing" &&
            room.actorsByAuthId[room.user.authId] &&
            room.actorsByAuthId[room.user.authId].isAlive) {
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

    document.getElementById("GameContainer").addEventListener("click", function (e) {
        wordInput.focus();
    });

    // addActor listener
    room.socket.on("addActor", function (actor) {
        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;

        drawing.addActorElement(actor.authId);
        drawing.updateStatusText();

        // If the user that just joined is the current user,
        // hide the join button
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
            room.data.roundStart = Date.now() + room.serverOffset;

            joinGameContainer.style.display = "none";
            startGameContainer.style.display = "none";
            wordInputContainer.style.display = "";

            if (room.actorsByAuthId[room.user.authId]) {
                wordInputContainer.classList.remove("Hidden");
            }

            room.data.currentRoundSettings = {};
            for (var i in room.data.nextRoundSettings) {
                room.data.currentRoundSettings[i] =
                    room.data.nextRoundSettings;
            }

            for (var j in room.actorsByAuthId) {
                // blank for now
            }

            drawing.mainElement.classList.add("Playing");

            game.remakeScoreboard();

            // Just focus as soon as the game starts I guess
            wordInput.focus();
        }
        else {
            wordInputContainer.style.display = "none";
            wordInputContainer.classList.add("Hidden");

            if (room.data.state === "starting" && room.data.actors[0] &&
                room.data.actors[0].authId === room.user.authId) {
                startGameContainer.style.display = "";
            }

            drawing.mainElement.classList.remove("Playing");
        }

        drawing.updateStatusText();
    });

    // newPrompts listener
    room.socket.on("newPrompts", function (prompts) {
        room.data.prompts = prompts;

        drawing.redrawPrompts();
    });

    // setWord listener
    room.socket.on("setWord", function (event) {
        room.actorsByAuthId[event.authId].lastWord = event.word;

        drawing.actorElemsByAuthId[event.authId].lastWord.innerHTML =
            escapeHTML(event.word.toUpperCase());

        drawing.updateUserScore(event.authId, true);
    });

    room.socket.on("winWord", function (event) {
        var actor = room.actorsByAuthId[event.authId];
        actor.lastWinWord = event.word;
        actor.lastWord = "";

        // Do something with the prompts here
        // I haven't decided yet what to do

        actor.wordsUsed++;
        room.data.wordsUsed++;
        actor.score = event.score;

        drawing.actorElemsByAuthId[event.authId].score.innerHTML = event.score;
        drawing.actorElemsByAuthId[event.authId].lastWord.innerHTML = "";
        game.updateScoreboard(actor.authId, "words", event.score);
        game.updateScoreboard(actor.authId, "score", event.score);

        // Deal with highlighting the prompts used somehow

        // Probably do something with the used word and display it here?
        drawing.actorElemsByAuthId[event.authId].applyAnimation("Shake0");

        // Maybe play a sound?
    });

    room.socket.on("updatePrompts", function (event) {
        var updatedPrompts = event.prompts;
        var cause = event.authId;

        for (var i = 0; i < updatedPrompts.length; i++) {
            room.data.prompts[updatedPrompts[i].index] = updatedPrompts[i].prompt;
            drawing.updatePrompt(updatedPrompts[i].index);
        }

        for (var authId in room.actorsByAuthId) {
            if (authId == cause) {
                continue;
            }

            drawing.updateUserScore(authId);
        }
    });

    room.socket.on("failWord", function (event) {
        var actor = room.actorsByAuthId[event.authId];

        // Alternate failword animation?
        drawing.actorElemsByAuthId[event.authId].applyAnimation("Shake1");
    });

    room.socket.on("endGame", function (event) {
        var winnerAuthId = event.authId;
        var elapsedTime = event.time;
        room.data.lastWinner = room.actorsByAuthId[winnerAuthId];

        // win sound?
        if (event.authId === room.user.authId) {
            // possibly play win sound?
        }

        joinGameContainer.style.display = "";
        wordInputContainer.style.display = "none";
        // Um. Take a look at this later.

        room.data.actors = [];
        room.actorsByAuthId = {};

        drawing.cleanUp();
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
};

game.initiateSettingsTab = function () {
    // Don't have any settings to initiate yet
};

game.updateSettingsTab = function () {
    // Yup.
};

/* Scoreboard Functions */

game.remakeScoreboard = function () {
    // TODO
};

game.updateScoreboard = function (authId, property, value) {
    // TODO
};

game.killScoreboardPlayer = function () {
    // TODO
};

window.drawing = {
    width: 800,
    radius: 350,

    actorElemsByAuthId: {},
    mainElement: document.getElementById("MainContainer"),
    actorsElement: document.getElementById("ActorContainer"),
    promptsElement: document.getElementById("PromptsContainer"),
    statusElement: document.getElementById("StatusContainer"),

    promptRadius: 150,
    promptControl: [],
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

    var scale = Math.min(
        parent.clientWidth / drawing.width,
        parent.clientHeight / drawing.width,
        1);

    container.style.WebkitTransform =
        container.style.MsTransform =
        container.style.transform = "scale(" + scale + ")";
};
window.addEventListener("optimizedResize", drawing.resizeGame);
window.dispatchEvent(new CustomEvent("optimizedResize"));

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

    var onerror = " onerror=\"if (this.src != '/images/AvatarPlaceholder.png') this.src = '/images/AvatarPlaceholder.png';\"";

    actorElement.innerHTML = "<div class=\"MainActorContainer\">" +
        "<img class=\"ProfilePicture\" src=\"" + source + "\"" + onerror + "></img>" +
        "<div class=\"TopContainer\">" +
        "<span class=\"NameContainer\">" +
        escapeHTML(actor.displayName) +
        "</span>" +
        "<div class=\"ScoreContainer\">" + 0 + "</div>" +
        "</div>" +
        "<div class=\"LastWordContainer\"></div>" +
        "<div class=\"NextScoreContainer\"></div>" +
        "</div>";

    drawing.actorsElement.appendChild(actorElement);

    var animClasses = [
        "Shake0",
        "Shake1",
        "Shake2",
        "Spin",
    ];

    drawing.actorElemsByAuthId[authId] = {
        element: actorElement,
        score: actorElement.querySelector(".ScoreContainer"),
        lastWord: actorElement.querySelector(".LastWordContainer"),
        nextScore: actorElement.querySelector(".NextScoreContainer"),
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
        drawing.actorsElement.removeChild(elem);
        delete drawing.actorElemsByAuthId[authId];

        drawing.recalculateActorElementPositions();
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
        HTML = "";
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

var setTransform = function (element, angle, radius) {
    element.style.WebkitTransform =
        element.style.MsTransform =
        element.style.transform =
        "rotate(" + angle + "deg) translate(" + radius + "px) rotate(-" + angle + "deg)";
};

drawing.redrawPrompts = function () {
    drawing.promptsElement.innerHTML = "";
    drawing.promptControl = [];

    for (var i = 0; i < room.data.prompts.length; i++) {
        var prompt = room.data.prompts[i].prompt.toUpperCase();
        var score = room.data.prompts[i].score;

        var promptObj = {
            active: 0,
            users: {},
        };

        var angle = 360 / room.data.prompts.length * i;

        for (var j = 0; j < 3; j++) {
            var container = document.createElement("DIV");
            container.classList.add("prompt-container");
            promptObj[j] = document.createElement("DIV");
            container.appendChild(promptObj[j]);
            drawing.promptsElement.appendChild(container);

            promptObj[j].classList.add("prompt");
        }

        drawing.promptControl.push(promptObj);
        drawing.updatePrompt(i);
    }
};

drawing.updatePrompt = function (index) {
    var angle = 360 / room.data.prompts.length * index;

    var promptObj = drawing.promptControl[index];

    promptObj.active++;
    if (promptObj.active > 2) promptObj.active = 0;

    var active = promptObj.active;
    var used = (active + 2) % 3;
    var hide = (used + 2) % 3;

    var prompt = room.data.prompts[index].prompt.toUpperCase();
    var score = room.data.prompts[index].score;

    promptObj[active].innerHTML =
        "<span class=\"prompt-score\">" + escapeHTML(score) + "</span>" +
        "<span class=\"prompt-text\">" + escapeHTML(prompt) + "</span>";

    promptObj[active].classList.remove("hide");
    setTransform(promptObj[active], angle, drawing.promptRadius);
    promptObj[active].style.opacity = 1;

    setTransform(promptObj[used], angle, drawing.promptRadius * 2);
    promptObj[used].style.opacity = 0;

    promptObj[hide].classList.add("hide");
    setTransform(promptObj[hide], angle, 0);
    promptObj[hide].style.opacity = 0;

    drawing.updateHighlightsByPrompt(index);
};

drawing.highlightPrompt = function (index) {
    var promptObj = drawing.promptControl[index];
    var active = promptObj[promptObj.active].querySelector(".prompt-text");

    active.classList.remove("player-using", "enemy-using", "both-using");

    var playerUsing = false,
        enemyUsing = false;

    for (var authId in promptObj.users) {
        if (authId === room.user.authId) {
            playerUsing = true;
        }
        else {
            enemyUsing = true;
        }
    }

    if (playerUsing && enemyUsing) {
        active.classList.add("both-using");
    }
    else if (playerUsing) {
        active.classList.add("player-using");
    }
    else if (enemyUsing) {
        active.classList.add("enemy-using");
    }
};

drawing.updateAllHighlights = function () {
    for (var i = 0; i < room.data.users; i++) {
        drawing.updateHighlights(word, room.data.users[i].authId, true);
        drawing.highlightPrompt(i);
    }
};

drawing.updateHighlights = function (word, authId, wait) {
    var using = [];

    for (var i = 0; i < room.data.prompts.length; i++) {
        var prompt = room.data.prompts[i].prompt;
        var users = drawing.promptControl[i].users;

        if (word.indexOf(prompt) > -1) {
            if (!users[authId]) {
                users[authId] = 1;
                if (!wait) drawing.highlightPrompt(i);
            }

            using.push(room.data.prompts[i].score);
        }
        else if (users[authId]) {
            delete users[authId];
            if (!wait) drawing.highlightPrompt(i);
        }
    }

    return using;
};

drawing.updateHighlightsByPrompt = function (index, wait) {
    var prompt = room.data.prompts[index].prompt;
    var users = drawing.promptControl[index].users;

    var changed = false;

    for (var i = 0; i < room.data.actors.length; i++) {
        var word = room.data.actors[i].lastWord;
        var authId = room.data.actors[i].authId;

        if (word.indexOf(prompt) > -1) {
            if (!users[authId]) {
                users[authId] = 1;
                changed = true;
            }
        }
        else if (users[authId]) {
            delete users[authId];
            changed = true;
        }
    }

    if (changed && !wait) drawing.highlightPrompt(index);
};

drawing.cleanUp = function () {
    drawing.actorsElement.innerHTML = "";
    drawing.actorElemsByAuthId = {};

    drawing.promptsElement.innerHTML = "";
    drawing.promptControl = [];
};

drawing.updateUserScore = function (authId, dontwait) {
    var actor = room.actorsByAuthId[authId];
    var scores = drawing.updateHighlights(actor.lastWord, authId, !dontwait);
    var sum = 0;
    for (var i = 0; i < scores.length; i++) {
        sum += scores[i];
    }
    var total = sum * scores.length;

    var scoresText = "";
    if (scores.length === 1) {
        scoresText = escapeHTML(scores[0]);
    }
    else if (scores.length > 1) {
        scoresText =
            escapeHTML("(" + scores.join(" + ") + ")") + " &times; " +
            escapeHTML(scores.length + " = " + total +
                (total < 25 ? "" : total < 50 ? "!" : total < 75 ? "!!" : total < 100 ? "!!!" : "!!!!!!"));
    }

    drawing.actorElemsByAuthId[authId].nextScore.innerHTML = scoresText;
};

})();
