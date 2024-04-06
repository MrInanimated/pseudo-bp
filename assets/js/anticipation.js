(function () {

window.game = {};

var dragMoveListener = function (event) {

    var target = event.target,
    x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx,
    y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

    target.style.webkitTransform =
    target.style.transform = 'translate(' + x + 'px, ' + y + 'px)';

    target.setAttribute("data-x", x);
    target.setAttribute("data-y", y);

    target.classList.add("dragging");
};

var dragStopListener = function (event) {
    event.target.classList.remove("dragging");
};

interact(".draggable")
    .draggable({
        restrict: {
            restriction: "parent",
            elementRect: { top: 0, left: 0, bottom: 1, right: 1 },
        },
        onmove: dragMoveListener,
        onend: dragStopListener,
    })
    .allowFrom(".handle");

game.onRoomData = function () {
    room.actorsByAuthId = {};
    var i;
    for (i = 0; i < room.data.actors.length; i++) {
        var actor = room.data.actors[i];
        room.actorsByAuthId[actor.authId] = actor;
        var row = game.addScoreboardRow(actor);
    }

    var statusMessage = "Waiting for players to join...";
    if (room.data.state == "drawing") {
        statusMessage = "Who's that Pokémon?";
    }
    else if (room.data.state === "result") {
        statusMessage = "It's " + room.data.lastWord.toUpperCase() + "!";
    }
    else if (room.data.state === "ending") {
        statusMessage = "Waiting for the next round...";
        game.end = true;
    }
    else if (room.data.state === "waiting") {
        game.end = true;
    }

    $("#Status").text(statusMessage);

    if (["drawing", "result"].indexOf(room.data.state) > -1) {
        $("#RoundCounter").text("Round " + room.data.rounds + " of " +
            room.data.currentRoundSettings.gameLength);
    }
};

game.init = function () {
    room.socket.on("addActor", function (actor) {
        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;
        game.addScoreboardRow(actor);
    });

    room.socket.on("removeActor", function (event) {
        var authId = event.authId;
        var actor = room.actorsByAuthId[authId];
        var index = room.data.actors.indexOf(actor);

        room.data.actors.splice(index);
        delete room.actorsByAuthId[actor.authId];

        room.checkAndScrollChat(function () {
            $(".scoreboard_" + authId.replace(":", "_")).remove();
        });
    });

    room.socket.on("setState", function (newState) {
        room.data.state = newState;

        if (newState === "waiting") {
            $("#Status").text("Waiting for more players to join...");
            $("#WordContainer, #Timer").text("");
            $("#RoundCounter").text("");

            game.cleanUp();
        }
        else if (newState === "drawing") {
            if (game.end) {
                game.end = false;
                game.cleanUp();
            }

            room.data.rounds++;

            for (var i = 0; i < room.data.actors.length; i++) {
                room.data.actors[i].success = false;
            }
            room.data.guessed.length = 0;

            $("#RoundCounter").text("Round " + room.data.rounds + " of " +
                room.data.currentRoundSettings.gameLength);

            $("#ScoreboardContent tr").removeClass("Drawing")
                .removeClass("Guessed");

            room.data.roundStart = Date.now() + room.serverOffset;
            drawing.startTimer();
        }
        else if (newState === "ending") {
            game.end = true;
        }

        if (newState !== "drawing") {
            drawing.stopTimer();
        }
    });

    room.socket.on("newRound", function (event) {
        $("#Status").text("Who's that Pokémon?");
        drawing.clear();
        audio.playSound("whosthatpokemon");
    });

    room.socket.on("reveal", function (event) {
        room.data.lastWord = event.word;
        $("#Status").text("It's " + event.word.toUpperCase() + "!");

        room.appendToChat("Info",
            escapeHTML(game.makePlayers(room.data.guessed)) +
            " found the word, \"" + escapeHTML(event.word) + "\".");
        audio.playSound("itspikachu");
    });

    room.socket.on("success", function (event) {
        room.appendToChat("Info",
            "Congratulations! You guessed the word \"" + escapeHTML(event.word) +
            "\" and earned " + escapeHTML(event.score) + " points!");
    });

    room.socket.on("successfulGuess", function (event) {
        if (event.authId !== room.user.authId &&
            room.data.guessed.length === 0
        ) {
            room.appendToChat("Info", "The word has been found!");
        }

        if (event.authId === room.user.authId) {
            audio.playSound("success");
        }
        else {
            audio.playSound("otherSuccess");
        }

        room.data.guessed.push(event.authId);

        room.actorsByAuthId[event.authId].score = event.score;
        game.updateScores(event.authId, event.score, true);

        game.sortScoreboard();
    });

    room.socket.on("almost", function (event) {
        room.appendToChat("Info",
            "\"" + escapeHTML(event.almost) + "\" is close to the answer!");
        audio.playSound("almost");
    });

    room.socket.on("endGame", function (event) {
        $("#Status").text(game.makePlayers(event.winners) + " won!");

        room.appendToChat("Info",
            escapeHTML(game.makePlayers(event.winners)) + " " +
            (event.winners.length > 1 ? "were" : "was") + " the winner" +
            (event.winners.length > 1 ? "s" : "") + "!");

        if (event.winners.indexOf(room.user.authId) > -1) {
            audio.playSound("pikachu");
        }
    });

    room.socket.on("afk", function (event) {
        var actor = room.actorsByAuthId[event.authId];
        actor.afk = event.afk;
        var className = ".scoreboard_" + event.authId.replace(":", "_");
        if (event.afk) {
            $(className).addClass("AFK");
        }
        else {
            $(className).removeClass("AFK");
        }

        if (event.authId === room.user.authId) {
            var message = "You're now marked as AFK.";
            if (!event.afk) {
                message = "You're no longer marked as AFK.";
            }
            room.appendToChat("Info", message);
        }
    });

    room.socket.on("drawLines", function (lines) {
        drawing.drawLines(lines);
    });

    room.socket.on("settings:wordLists", function (e) {
        room.data.nextRoundSettings.wordLists = e.list;
        var name;
        var match;
        if ((match = e.wordList.match(/pokemon_gen_(\d+)/))) {
            name = "Pokémon Gen " + match[1];
        }

        if (e.operation === "add") {
            room.appendToChat("Info", "The " + name +
                " word list has been added for the next round.");
        }
        else {
            room.appendToChat("Info", "The " + name +
                " word list has been removed for the next round.");
        }

        game.updateSettingsTab();
    });
};

game.makePlayers = function (authIds) {
    if (authIds.length === 0) {
        return "Nobody";
    }

    var players = authIds.map(function (i) {
        if (room.actorsByAuthId[i])
            return room.actorsByAuthId[i].displayName;
        else
            return "(player left)";
    });

    var acc = "";

    for (var i = 0; i < players.length; i++) {
        acc += players[i];

        if (i < players.length - 2) {
            acc += ", ";
        }
        else if (i < players.length - 1) {
            acc += " and ";
        }
    }

    if (players.length < 3) {
        return acc;
    }
    else {
        return players.length + " players (" + acc + ")";
    }
};

// This is basically the startGame function now
game.cleanUp = function () {
    room.data.currentRoundSettings = room.data.nextRoundSettings;
    room.data.nextRoundSettings = $.extend({}, room.data.currentRoundSettings);

    for (var i = 0; i < room.data.actors.length; i++) {
        room.data.actors[i].score = 0;
        room.data.actors[i].successful = false;
    }

    $("#ScoreboardContent td:last-child")
        .removeClass("Drawing")
        .removeClass("Guessed")
        .text("0");

    drawing.clear();

    room.data.rounds = 0;
    room.data.guessed = [];
};

game.onDisconnected = function (disconnectReason) {
    switch (disconnectReason) {
        case "kicked":
            $("#Status").text("It looks like you've been kicked!");
            break;
        case "banned":
            $("#Status").text("It looks like you've been banned!");
            break;
        default:
            $("#Status").text("It looks like you got disconnected...");
            break;
    }

    room.data.state = "disconnected";
    $("#GameCanvas").removeClass("Playing");
    drawing.stopTimer();
};

game.addScoreboardRow = function (actor) {
    var row = $(document.createElement("tr"))
        .addClass("scoreboard_" + actor.authId.replace(":", "_"))
        .append($(document.createElement("td"))
            .text(actor.displayName))
        .append($(document.createElement("td"))
            .text(actor.score));

    if (["drawing", "guessed", "result"].indexOf(room.data.state > -1)) {
        if (actor.authId === room.data.currentArtist) {
            row.addClass("Drawing");
        }
        if (actor.successful) {
            row.addClass("Guessed");
        }
        if (actor.afk) {
            row.addClass("AFK");
        }
    }

    room.checkAndScrollChat(function () {
        $("#ScoreboardContent").append(row);
    });

    game.sortScoreboard();

    return row;
};

game.sortScoreboard = function () {
    room.checkAndScrollChat(function () {
        var $rows = $("#ScoreboardContent").find("tr");

        $rows.sort(function (a, b) {
            var getScore = function (el) {
                return parseInt($(el).find("td:last-child").text());
            };

            return getScore(b) - getScore(a);
        });

        $rows.detach().appendTo($("#ScoreboardContent"));
    });
};

game.updateScores = function (authId, score, found) {
    $row = $(".scoreboard_" + authId.replace(":", "_"));

    if (found) {
        $row.addClass("Guessed");
    }

    $row.find("td:last-child").text(score);
};

game.initiateSettingsTab = function () {
    $("#WordListsControl a").click(function (event) {
        if (room.user.role >= roles.host) {
            room.socket.emit("settings:wordLists", {
                wordList: this.dataset.value,
                operation: this.classList.contains("Selected") ? "remove" : "add",
            });
        }
    });
};

game.updateSettingsTab = function () {
    var canModify = room.user.role >= roles.host;

    var i, j;

    var unmodifiableControls = [
        "WordListsControl",
    ].map(document.getElementById, document);

    for (i = 0; i < unmodifiableControls.length; i++) {
        unmodifiableControls[i].classList[canModify ? "remove": "add"](
            "Disabled");
    }

    $("#WordListsControl a").each(function (index, element) {
        if (room.data.nextRoundSettings.wordLists.indexOf(element.dataset.value) > -1) {
            element.classList.add("Selected");
        }
        else {
            element.classList.remove("Selected");
        }
    });
};

game.remakeScoreboard = function () {

};

window.drawing = {
    buffer: [],
};

var canvas = $("#GameCanvas")[0];
var ctx = canvas.getContext("2d");

var draw = function () {
    if (drawing.buffer.length) {
        var path = drawing.buffer.shift();
        if (path.length) {
            ctx.beginPath();
            ctx.moveTo(path[0][0], path[0][1]);
            for (var i = 1; i < path.length; i++) {
                ctx.lineTo(path[i][0], path[i][1]);
            }
            ctx.stroke();
        }
    }
};

var update = function () {
    draw();
    requestAnimationFrame(update);
};
update();

var flush = function () {
    while (drawing.buffer.length) {
        draw();
    }
};

drawing.drawLines = function (lines) {
    flush();
    drawing.buffer = window.drawing.buffer.concat(lines);
};

drawing.clear = function () {
    canvas.width = 600;
    canvas.height = 600;
    drawing.buffer.length = 0;
};

var timerInterval;

var sounds = {
    almost: "/sounds/failWord.wav",
    success: "/sounds/success.wav",
    otherSuccess: "/sounds/otherSuccess.wav",
    whosthatpokemon: "/sounds/whosthatpokemon.wav",
    itspikachu: "/sounds/itspikachu.wav",
    pikachu: "/sounds/pikachu.wav",
};

for (var i in sounds) {
    audio.loadSound(i, sounds[i]);
}

drawing.startTimer = function () {
    clearInterval(timerInterval);
    timerInterval = setInterval(function () {
        var elapsed = Date.now() - room.data.roundStart + room.serverOffset;
        var timeLeft = room.data.currentRoundSettings.roundTimer - elapsed;

        var seconds = Math.ceil(timeLeft / 1000);

        $("#Timer").text(Math.max(seconds, 0));
    }, 250);
};

drawing.stopTimer = function () {
    clearInterval(timerInterval);
    $("#Timer").text("").removeClass("Guessed");
};

$(function () {
    if (!$("#Scoreboard").hasClass("Open")) {
        $("#ShowScoreboard").click();
    }
});

})();
