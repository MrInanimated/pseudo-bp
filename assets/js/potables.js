var LineDrawing = function(canvas, paths) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.paths = paths || [];
    this.maxPoints = 512;
    this.isDrawing = false;

    this.redraw();
};

LineDrawing.prototype.mousePos = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var scaleX = this.canvas.width / rect.width;
    var scaleY = this.canvas.height / rect.height;

    return [
        ((e.clientX - rect.left) * scaleX * 100 | 0) / 100,
        ((e.clientY - rect.top) * scaleY * 100 | 0) / 100,
    ];
};

LineDrawing.prototype.totalPoints = function () {
    var points = 0;
    for (var i = 0; i < this.paths.length; i++) {
        points += this.paths[i].length;
    }
    return points;
};

LineDrawing.prototype.reset = function () {
    this.isDrawing = false;
    this.paths = [];
    this.redraw();
};


var sq = function (x) {
    return x * x;
};

LineDrawing.prototype.start = function (e) {
    if (this.isDrawing || this.totalPoints() >= this.maxPoints) {
        return;
    }

    var p = this.mousePos(e);

    this.isDrawing = true;
    this.paths.push([p, p]);
    this.redraw();
};

LineDrawing.prototype.continue = function (e) {
    if (!this.isDrawing)
        return;

    var p = this.mousePos(e);

    if (this.totalPoints() >= this.maxPoints)
        return this.end(p);

    var lastPath = this.paths[this.paths.length - 1];
    var last = lastPath[lastPath.length - 2];
    if (sq(last[0] - p[0]) + sq(last[1] - p[1]) <= 9) {
        lastPath[lastPath.length - 1] = p;
    }
    else {
        lastPath.push(p);
    }

    this.redraw();
};

LineDrawing.prototype.end = function (e) {
    if (!this.isDrawing)
        return;

    this.isDrawing = false;
    this.redraw();
};

LineDrawing.prototype.redraw = function () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (var i = 0; i < this.paths.length; i++) {
        var path = this.paths[i];
        if (path.length > 0) {
            this.ctx.strokeStyle = "black";
            this.ctx.lineWidth = 2.5;
            this.ctx.lineCap = "round";
            this.ctx.lineJoin = "round";

            this.ctx.beginPath();
            this.ctx.moveTo(path[0][0], path[0][1]);
            for (var j = 1; j < path.length; j++) {
                /*
                var midX = (path[j-1][0] + path[j][0]) / 2;
                var midY = (path[j-1][1] + path[j][1]) / 2;
                this.ctx.quadraticCurveTo(path[j][0], path[j][1], midX, midY);
                */
                this.ctx.lineTo(path[j][0], path[j][1]);
            }
            this.ctx.stroke();
        }
    }
};

var game = window.game = {};

game.onRoomData = function () {
    $("#JoinHostButton")
        .removeClass("Disabled")
        .text("Join as Host");

    room.actorsByAuthId = {};
    for (var i = 0; i < room.data.actors.length; i++) {
        var actor = room.data.actors[i];
        room.actorsByAuthId[actor.authId] = actor;
    }
};

game.init = function () {
    room.socket.on("addActor", function (actor) {
        room.data.actors.push(actor);
        room.actorsByAuthId[actor.authId] = actor;

        drawing.addPlayer(actor);
        drawing.addScoreboardRow(actor);

        if (actor.authId === room.user.authId) {
            $("#JoinHostButton, #PreparingJoinButton, #PlayingJoinButton")
                .addClass("Disabled");
        }
    });

    room.socket.on("removeActor", function (event) {
        var authId = event.authId;
        var actor = room.actorsByAuthId[authId];
        var index = room.data.actors.indexOf(actor);

        room.data.actors.splice(index, 1);
        delete room.actorsByAuthId[authId];

        if (game.state.state === "waiting") {
            if (actor.isHost && room.data.actors[0]) {
                room.data.actors[0].isHost = true;
            }
        }

        drawing.removePlayer(actor);
    });

    room.socket.on("clearActors", function () {
        room.data.actors = [];
        room.actorsByAuthId = {};

        drawing.updatePlayers();

        $("#ScoreboardContent").empty();
    });

    room.socket.on("setState", function (state) {
        drawing.getCurrentPlayerContainer().empty();

        var prevState = game.state;
        if (prevState !== "playing" && state === "playing") {
            room.data.currentRoundSettings = room.data.nextRoundSettings;
            room.data.nextRoundSettings = $.extend({}, room.data.currentRoundSettings);
        }

        game.state = state;

        var actor = room.actorsByAuthId[room.user.authId];
        var isHost = actor && actor.isHost;

        $(".views > .active").removeClass("active");
        $(".tab-scroll.right").removeClass("right");
        $("#QuestionModal").removeClass("active");
        $("#GameContainer button.Disabled").removeClass("Disabled");

        if (actor) {
            $("#GameContainer").addClass("ingame");
        }
        else {
            $("#GameContainer").removeClass("ingame");
        }

        if (isHost) {
            $("#GameContainer").addClass("host");
        }
        else {
            $("#GameContainer").removeClass("host");
        }

        // TODO state transition function
        switch (state.state) {
        case "waiting":
            $("#MainWaitingView").addClass("active");
            if (actor || room.data.actors.length > 0) {
                $("#JoinHostButton").addClass("Disabled");
            }
            break;
        case "preparing":
            $("#MainPreparingView, #PreparingView").addClass("active");
            if (isHost) {
                $("#PreparingJoinButton").text("Start Game");
            }
            else {
                $("#PreparingJoinButton").text("Join Game");
                if (actor) {
                    $("#PreparingJoinButton").addClass("Disabled");
                }
            }

            drawing.updatePlayers();

            if (isHost) {
                drawing.updateCategories();
            }
            break;
        case "playing":
            drawing.updatePlayers();
            if (actor) {
                $("#PlayingJoinButton").addClass("Disabled");
            }

            switch (state.gameState.state) {
            case "board":
                $("#MainPlayingView, #PlayingView").addClass("active");
                drawing.updateBoard();

                break;
            case "question":
                $("#MainPlayingView, #PlayingView").addClass("active");
                $("#PlayingView").addClass("right");
                drawing.updateBoard();

                drawing.showQuestion(state.gameState);

                if (isHost) {
                    drawing.updateAnswer();
                }

                drawing.updateQuestionControls(prevState, state);

                break;
            case "end":
                $("#MainEndView").addClass("active");
                drawing.sortPlayers();
                break;
            }
            break;
        }
    });

    room.socket.on("setScore", function (event) {
        var actor = room.actorsByAuthId[event.authId];
        actor.score = event.score;

        drawing.updatePlayer(event);
    });

    room.socket.on("databaseError", function () {
        room.appendToChat("Info",
            "There was a problem accessing the database. Please try again.");
    });

    room.socket.on("hostLeft", function () {
        room.appendToChat("Info", "The host left the game.");
    });

    room.socket.on("hostSetScore", function (e) {
        var actor = room.actorsByAuthId[e.authId];
        var before = (e.before >= 0 ? "$" : "-$") + Math.abs(e.before);
        var after = (e.after >= 0 ? "$" : "-$") + Math.abs(e.after);
        room.appendToChat("Info",
            "The host changed the score of " + escapeHTML(actor.displayName) +
            " from " + before + " to " + after + ".");
    });

    room.socket.on("bank", function (bank) {
        game.bank = bank;

        drawing.updateCategories();
        drawing.updateQuestions();
    });

    room.socket.on("effect:fillBoard", function () {
        audio.playSound("fillBoard");
    });


    room.socket.on("effect:correct", function () {
        audio.playSound("correct");
    });

    room.socket.on("effect:incorrect", function () {
        audio.playSound("incorrect");
    });

    room.socket.on("effect:timeout", function () {
        audio.playSound("timeout");
    });

    room.socket.on("effect:end", function () {
        audio.playSound("end");
    });

    room.socket.on("settings:answerStyle", function (e) {
        room.data.nextRoundSettings.answerStyle = e;

        switch (e) {
        case "buzz":
            room.appendToChat("Info", "In the next round, players will answer by buzzing in.");
            break;
        case "write":
            room.appendToChat("Info", "In the next round, players will answer by each writing in their answers.");
            break;
        default:
            break;
        }

        game.updateSettingsTab();
    });
};

game.onDisconnected = function (disconnectReason) {
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

    setupButtons("AnswerStyleControl", "settings:answerStyle");
};

game.updateSettingsTab = function () {
    var canModify = room.user.role >= roles.host;

    var i, j;

    var unmodifiableControls = [
        "AnswerStyleControl",
    ].map(document.getElementById, document);

    for (i = 0; i < unmodifiableControls.length; i++) {
        unmodifiableControls[i].classList[canModify ? "remove": "add"](
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

    highlightValue("AnswerStyleControl",
        room.data.nextRoundSettings.answerStyle);
};

game.isHost = function () {
    return room.actorsByAuthId[room.user.authId] &&
        room.actorsByAuthId[room.user.authId].isHost;

}

var mdrenderer = markdownit();
var md = mdrenderer.renderInline.bind(mdrenderer);

var drawing = window.drawing = {
    categories: {
        $first: $("#FirstRound"),
        $double: $("#DoubleRound"),
    },
    $categoryName: $("#CategoryName"),
    $questions: $("#Questions"),
    $board: $("#Board"),
    $questionModal: $("#QuestionModal"),
    joinDrawing: new LineDrawing($("#JoinCanvas")[0]),
};

drawing.makePlayerCard = function (actor) {
    var userActor = room.actorsByAuthId[room.user.authId];
    var isHost = userActor && userActor.isHost;
    var $playerScoreElement;
    if (isHost) {
        $playerScoreElement = $("<input>")
            .addClass("player-score")
            .attr("type", "text")
            .attr("size", "1")
            .val(actor.score)
            .change(function () {
                room.socket.emit("setScore", {
                    authId: actor.authId,
                    score: parseInt($playerScoreElement.val()),
                })
            })
            .focusout(function () {
                $playerScoreElement.val(actor.score);
            });
    }
    else {
        $playerScoreElement = $("<div>")
            .addClass("player-score")
            .addClass(actor.score < 0 ? "negative" : "")
            .text(actor.score >= 0 ? "$" + actor.score : "-$" + (-actor.score));
    }

    var $card = $("<div>")
        .addClass("player-card-container")
        .addClass("player-" + actor.authId.replace(":", "_"))
        .append(
            $("<div>")
            .addClass("player-card")
            .addClass("box")
            .append(
                actor.drawing ?
                    $("<canvas>")
                    .addClass("player-canvas")
                    .attr("width", "200")
                    .attr("height", "150")
                :
                    $("<div>")
                    .addClass("player-name-container")
                    .append(
                        $("<span>")
                        .addClass("player-name")
                        .text(actor.displayName)
                    )
            )
            .append(
                $playerScoreElement
            )
        );

    if (actor.drawing) {
        var l = new LineDrawing($card.find("canvas")[0], actor.drawing);
    }

    return $card;
};

drawing.makeGradingCard = function (actor, answer) {
    var userActor = room.actorsByAuthId[room.user.authId];
    var isHost = userActor && userActor.isHost;

    var isPass = !answer || answer.type === "passed" || answer.answer === '';
    var answerText = answer && answer.type !== "passed" && answer.answer;

    var $answerElement = $("<div>")
        .addClass("player-answer")
        .toggleClass("passed", isPass)
        .text(isPass ? "(Passed)" : answerText);
    var $card = $("<div>")
        .addClass("player-grading-card-container")
        .addClass("player-" + actor.authId.replace(":", "_"))
        .attr("data-auth-id", actor.authId)
        .append(
            $("<div>")
            .addClass("player-card")
            .addClass("box")
            .append(
                actor.drawing ?
                    $("<canvas>")
                    .addClass("player-canvas")
                    .attr("width", "200")
                    .attr("height", "150")
                :
                    $("<div>")
                    .addClass("player-name-container")
                    .append(
                        $("<span>")
                        .addClass("player-name")
                        .text(actor.displayName)
                    )
            )
            .append(
                $answerElement
            )
        );

    if (isHost && !isPass) {
        var $playerGrader = $("<div>")
            .addClass("player-grader");

        var $correctButton = $("<button>")
            .addClass("Button Correct SmallIcon")
            .append($("<i>").addClass("fa fa-check"));

        $correctButton.click(function () {
            room.socket.emit("grade", actor.authId, true);
        });

        var $incorrectButton = $("<button>")
            .addClass("Button Incorrect SmallIcon")
            .append($("<i>").addClass("fa fa-times"))
        $incorrectButton.click(function () {
            room.socket.emit("grade", actor.authId, false);
        });

        $playerGrader.append($correctButton).append($incorrectButton);

        $card.append($playerGrader);
    }

    if (actor.drawing) {
        var l = new LineDrawing($card.find("canvas")[0], actor.drawing);
    }

    return $card;
};

drawing.updateGradingCards = function (grading) {
    var $gradingCards = $(".player-grading-card-container");
    for (var i = 0; i < $gradingCards.length; i++) {
        var $card = $($gradingCards[i]);
        var authId = $card.attr("data-auth-id");
        if (!authId) {
            continue;
        }

        var grade = grading[authId];
        $card.toggleClass("correct", grade === true);
        $card.toggleClass("incorrect", grade === false);
    }
};

drawing.hostCardTemplate = function () {
    return $("<div>")
        .addClass("card")
        .addClass("box")
        .append(
            $("<button>")
            .addClass("card-reroll")
            .append(
                $("<i>")
                .addClass("fa fa-repeat fa-2x fa-fw")
            )
        )
        .append(
            $("<div>")
            .addClass("card-text-container")
        )
        .append(
            $("<button>")
            .addClass("card-next")
            .append(
                $("<i>")
                .addClass("fa fa-chevron-right fa-2x fa-fw")
            )
        );
};

drawing.makeQuestionCard = function (question, round, catNum, qNum) {
    var $card = drawing.hostCardTemplate();
    $card.find(".card-next").remove();
    $card.find(".card-text-container")
        .append(
            $("<div>")
            .addClass("card-question")
            .html(md(question.prompt || ""))
        )
        .append(
            $("<div>")
            .addClass("card-answer")
            .html(md(question.answer || ""))
        );
    $card.find(".card-reroll")
        .click(function () {
            room.socket.emit("rerollQuestion", round, catNum, qNum);
        });
    return $card;
};

drawing.makeCategoryCard = function (category, round, catNum) {
    var $card = drawing.hostCardTemplate();
    $card.find(".card-text-container")
        .append(
            $("<div>")
            .addClass("card-category")
            .html(md(category.name || ""))
        );
    $card.find(".card-reroll").click(function () {
        room.socket.emit("rerollCategory", round, catNum);
    });
    $card.find(".card-next").click(function () {
        drawing.$questions
            .data("round", round)
            .data("category", catNum);

        drawing.updateQuestions();

        $("#PreparingView").addClass("right");
    });

    return $card;
};

drawing.updateQuestions = function () {
    var round = drawing.$questions.data("round") || "first";
    var catNum = drawing.$questions.data("category") || 0;

    var bank = game.bank || {};
    var categories = bank[round] || [];
    var category = categories[catNum] || {};
    var name = category.name || "Invalid Category";
    var questions = category.questions || [];

    $("#CategoryName").html(md(name));

    drawing.$questions.empty();

    for (var i = 0; i < questions.length; i++) {
        var question = questions[i] || {
            prompt: "Invalid Question",
            answer: "",
        };
        drawing.$questions.append(
            drawing.makeQuestionCard(question, round, catNum, i)
        );
    }
};

drawing.updateCategories = function () {
    var bank = game.bank || {};
    drawing.categories.$first.empty();
    drawing.categories.$double.empty();

    var categories = bank["first"] || [];
    for (var i = 0; i < categories.length; i++) {
        var category = categories[i] || { name: "Invalid Category" };
        drawing.categories.$first.append(
            drawing.makeCategoryCard(category, "first", i)
        );
    }

    categories = bank["double"] || [];
    for (var i = 0; i < categories.length; i++) {
        var category = categories[i] || { name: "Invalid Category" };
        drawing.categories.$double.append(
            drawing.makeCategoryCard(category, "double", i)
        );
    }
};

drawing.makeBoardCategory = function (category, catNum, round) {
    var $category = $("<div>")
        .addClass("board-category");

    $category.append(
        $("<div>")
        .addClass("board-cell")
        .append(
            $("<div>")
            .addClass("board-category-name")
            .html(md(category.categoryName || ""))
        )
    );

    var bind = function ($span, i) {
        $span.click(() => {
            room.socket.emit("selectQuestion", catNum, i);
        });
    }

    for (var i = 0; i < 5; i++) {
        var $span = $("<span>")
            .addClass("board-category-question")
            .text(category.questions[i] ? "$" + category.questions[i] : "")

        if (game.isHost()) {
            bind($span, i);
        }

        $category.append(
            $("<div>")
            .addClass("board-cell")
            .append($span)
        );
    }

    return $category;
};

drawing.updateBoard = function () {
    drawing.$board.empty();

    var gameState = game.state.gameState || {};
    var board = gameState.board || [];
    var round = gameState.state || "first";

    for (var i = 0; i < board.length; i++) {
        drawing.$board.append(
            drawing.makeBoardCategory(board[i], i, round)
        );
    }
};

drawing.showQuestion = function (gameState) {
    drawing.$questionModal.addClass("active");

    var text;
    if (gameState.qState.answer) {
        text = "Answer:<br>" + md(gameState.qState.answer);
    }
    else {
        text = md(gameState.qState.question.prompt) || "<Invalid Clue>";
    }
    var catNum = gameState.qState.question.categoryNumber;
    var category = md(gameState.board[catNum].categoryName);
    var score = gameState.qState.question.score;

    $("#QuestionText").html(text);
    $("#QuestionCategory").html(category + " for $" + score);
};

drawing.getCurrentPlayerContainer = function () {
    switch ((game.state || {}).state) {
        case "waiting":
        case "preparing":
            return $("#PreparingPlayerContainer");
        case "playing":
            if (game.state.gameState.state === "end") {
                return $("#EndPlayerContainer");
            }
            else {
                return $("#PlayerContainer");
            }
    }

    return $();
};

drawing.updateQuestionControls = function (prevState, state) {
    if (state.state !== "playing" || state.gameState.state !== "question") {
        return;
    }

    var prevQuestionState;
    if (prevState.gameState && prevState.gameState.qState) {
        prevQuestionState = prevState.gameState.qState.state;
    }

    var questionState = state.gameState.qState;

    var buzzButton = $("#Buzz");
    var writeInControls = $("#WriteInControls");
    var gradingControls = $("#GradingControls");

    var isWriteIn = questionState.state.endsWith("-write");
    buzzButton.toggleClass("Hidden", isWriteIn);
    writeInControls.toggleClass("Hidden", !isWriteIn);
    gradingControls.addClass("Hidden");

    switch (questionState.state) {
    case "released":
        buzzButton.toggleClass("Disabled", !!questionState.hasAnswered[room.user.authId]);
        break;
    case "reading":
    case "answering":
    case "reveal":
        buzzButton.addClass("Disabled");
        break;
    case "reading-write":
        if (prevQuestionState !== "reading-write" && !game.isHost()) {
            $("#AnswerInput").val("").focus();
        }
    case "released-write":
        var hasAnswered = !!questionState.hasAnswered[room.user.authId];
        $("#AnswerInput").attr("disabled", hasAnswered ? "true" : null);
        $("#AnswerSubmit").toggleClass("Disabled", hasAnswered);
        $("#AnswerAnswerPass").toggleClass("Disabled", hasAnswered);
        break;
    case "grading-write":
        writeInControls.addClass("Hidden");
        gradingControls.removeClass("Hidden");
        if (prevQuestionState !== "grading-write") {
            gradingControls.empty();

            for (var i = 0; i < room.data.actors.length; i++) {
                var actor = room.data.actors[i];
                if (actor.isHost) {
                    continue;
                }
                var $card = drawing.makeGradingCard(actor, questionState.attempts[actor.authId]);
                gradingControls.append($card);
            }
        }

        drawing.updateGradingCards(questionState.grading);
        break;
    }
};

drawing.updatePlayers = function () {
    var $playerContainer = drawing.getCurrentPlayerContainer();
    $playerContainer.empty();
    for (var i = 0; i < room.data.actors.length; i++) {
        var actor = room.data.actors[i];
        if (actor.isHost)
            continue;

        var $card = drawing.makePlayerCard(actor);
        if (game.state.state === "playing" &&
            game.state.gameState.state === "question" &&
            game.state.gameState.qState.state === "answering" &&
            game.state.gameState.qState.answerer === actor.authId) {
                $card.addClass("selected");
        }

        if (game.state.state === "playing" &&
            game.state.gameState.state === "question" &&
            (game.state.gameState.qState.state === "reading-write" || game.state.gameState.qState.state === "released-write") &&
            game.state.gameState.qState.hasAnswered[actor.authId]) {
                $card.addClass("selected");
        }

        $playerContainer.append($card);

        if (!$(".scoreboard_" + actor.authId.replace(":", "_")).length) {
            drawing.addScoreboardRow(actor, true);
        }
    }

    drawing.sortScoreboard();
};

drawing.sortPlayers = function () {
    var $playerContainer = drawing.getCurrentPlayerContainer();
    var $players = $playerContainer.find(".player-card-container");

    var getScore = function(el) {
        var $playerScoreElem = $(el).find(".player-score");
        if ($playerScoreElem.is("div")) {
            return parseInt($playerScoreElem.text().replace("$", ""));
        }
        else {
            return parseInt($playerScoreElem.val());
        }
    };

    $players.sort(function (a, b) {
        return getScore(b) - getScore(a);
    });

    $players.detach().appendTo($playerContainer);

    drawing.sortScoreboard();
};

drawing.addPlayer = function (actor) {
    var $playerContainer = drawing.getCurrentPlayerContainer();
    $playerContainer.append(drawing.makePlayerCard(actor));
};

drawing.removePlayer = function (actor) {
    $(".player-" + actor.authId.replace(":", "_")).remove();

    drawing.removeScoreboardPlayer(actor);
};

drawing.updatePlayer = function (actor) {
    var $playerScoreElem =
        $(".player-" + actor.authId.replace(":", "_") + " .player-score");

    if ($playerScoreElem.is("div")) {
        $playerScoreElem
            [actor.score >= 0 ? "removeClass" : "addClass"]("negative")
            .text(actor.score >= 0 ? "$" + actor.score : "-$" + (-actor.score));
    }
    else {
        $playerScoreElem.val(actor.score);
    }

    drawing.updateScoreboardPlayer(actor);
};

drawing.updateAnswer = function () {
    var bank = game.bank || {};
    var gameState = game.state.gameState || {};
    var qState = gameState.qState || {};
    var qStub = qState.question || {};
    var round = gameState.round || "first";
    var category = (bank[round] || [])[qStub.categoryNumber] || [];
    var question = category.questions[qStub.questionNumber] || {};
    var answer = question.answer || "Invalid Answer";

    if (qState.state === "grading-write") {
        var $continueButton = $("<button>")
            .addClass("Button")
            .text("Finished grading")
            .click(function () {
                room.socket.emit("gradeComplete");
            });
        $("#Answer").empty().append($continueButton);
    } else {
        $("#Answer").html(md(answer));
    }

    $("#BuzzContainer").removeClass("active");
    $("#PlayingQuestionView .Disabled").removeClass("Disabled");

    switch (qState.state) {
        case "reading":
            $("#CorrectButton, #IncorrectButton").addClass("Disabled");
            break;
        case "released":
            $("#ReleaseButton, #CorrectButton, #IncorrectButton").addClass("Disabled");
            break;
        case "answering":
            $("#ReleaseButton").addClass("Disabled");
            $("#BuzzContainer").addClass("active");
            var authId = qState.answerer;
            var actor = room.actorsByAuthId[authId];
            if (actor) {
                $("#BuzzName").text(actor.displayName);
            }
            else {
                $("#BuzzName").text("<Invalid Actor>");
            }
            break;
        case "reveal":
            $("#PlayingQuestionView button").addClass("Disabled");
        default:
            $("#CorrectButton, #IncorrectButton").addClass("Disabled");
            break;
    }
};

drawing.addScoreboardRow = function (actor, nosort) {
    if (actor.isHost) return;

    var row = $("<tr>")
        .addClass("scoreboard_" + actor.authId.replace(":", "_"))
        .append($("<td>")
            .text(actor.displayName))
        .append($("<td>")
            [actor.score >= 0 ? "removeClass": "addClass"]("negative")
            .text(actor.score >= 0 ? "$" + actor.score : "-$" + (-actor.score)));

    room.checkAndScrollChat(function () {
        $("#ScoreboardContent").append(row);
    });

    if (!nosort)
        drawing.sortScoreboard();

    return row;
};

drawing.updateScoreboardPlayer = function (actor) {
    $(".scoreboard_" + actor.authId.replace(":", "_")).find("td:last-child")
        [actor.score >= 0 ? "removeClass": "addClass"]("negative")
        .text(actor.score >= 0 ? "$" + actor.score : "-$" + (-actor.score));

    drawing.sortScoreboard();
};

drawing.removeScoreboardPlayer = function (actor) {
    $(".scoreboard_" + actor.authId.replace(":", "_")).remove();
};

drawing.sortScoreboard = function () {
    var getScore = function (el) {
        return parseInt($(el).find("td:last-child").text().replace("$", ""));
    };

    room.checkAndScrollChat(function () {
        var $rows = $("#ScoreboardContent").find("tr");
        $rows.sort(function (a, b) {
            return getScore(b) - getScore(a);
        });

        $rows.detach().appendTo($("#ScoreboardContent"));
    });
};

$("#JoinHostButton").click(function () {
    room.socket.emit("join");
});

$("#PreparingJoinButton").click(function () {
    if (game.isHost()) {
        room.socket.emit("startGame");
    }
    else {
        $("#JoinOverlay").addClass("active");
        drawing.joinDrawing.reset();
        progress();
    }
});

$("#PlayingJoinButton").click(function () {
    $("#JoinOverlay").addClass("active");
    drawing.joinDrawing.reset();
    progress();
});

$("#Buzz").click(function () {
    room.socket.emit("buzz");
});

$("#BackButton").click(function () {
    $("#PreparingView").removeClass("right");
});

$("#ReleaseButton").click(function () {
    room.socket.emit("release");
});

$("#CorrectButton").click(function () {
    room.socket.emit("validate", true);
});

$("#IncorrectButton").click(function () {
    room.socket.emit("validate", false);
});

$("#SkipButton").click(function () {
    room.socket.emit("skipQuestion");
});

function throttle (callback, threshold) {
    var last;
    var deferTimer;
    return function () {
        var ctx = this;
        var args = arguments;
        var now = Date.now();
        if (last && now < last + threshold) {
            if (deferTimer === undefined) {
                deferTimer = setTimeout(function () {
                    last = Date.now();
                    callback.apply(ctx, args);
                    deferTimer = undefined;
                }, threshold);
            }
        } else {
            last = now;
            callback.apply(ctx, args);
        }
    }
}

$("#AnswerInput").on("keyup change", throttle(function () {
    room.socket.emit("writeIn", $(this).val());
}, 250));

$("#AnswerInput").on("keypress", function (e) {
    if (e.which === 13) {
        room.socket.emit("writeSubmit", $(this).val());
        return false;
    }
});

$("#AnswerSubmit").click(function () {
    room.socket.emit("writeSubmit", $("#AnswerInput").val());
});

$("#AnswerPass").click(function () {
    room.socket.emit("writePass");
    $("#AnswerInput").val("");
});

var progress = function () {
    var d = drawing.joinDrawing;
    var remaining = d.maxPoints - d.totalPoints();
    remaining = Math.max(remaining, 0);

    var percent = (remaining / d.maxPoints * 100) + "%";
    $("#JoinCanvasProgressBar").css("width", percent);
};

var canvas = $("#JoinCanvas")[0];
canvas.addEventListener("mousedown", function (e) {
    drawing.joinDrawing.start(e);
    progress();
});
canvas.addEventListener("mousemove", function (e) {
    drawing.joinDrawing.continue(e);
    progress();
});
canvas.addEventListener("mouseup", function (e) {
    drawing.joinDrawing.end(e);
    progress();
});
canvas.addEventListener("mouseout", function (e) {
    drawing.joinDrawing.end(e);
    progress();
});

$("#JoinCanvasClear").click(function () {
    drawing.joinDrawing.reset();
    progress();
});

$("#DrawingJoin").click(function () {
    room.socket.emit("drawingJoin", drawing.joinDrawing.paths);
    $("#JoinOverlay").removeClass("active");
});

$("#NameJoin").click(function () {
    room.socket.emit("join");
    $("#JoinOverlay").removeClass("active");
});

var sounds = {
    fillBoard: "/sounds/fill_board.wav",
    correct: "/sounds/success.wav",
    incorrect: "/sounds/failWord.wav",
    timeout: "/sounds/winWord.wav",
    end: "/sounds/potables_end.wav",
};

for (var i in sounds) {
    audio.loadSound(i, sounds[i]);
}

var answerTimer = document.getElementById("AnswerTimer");
var timerUpdater = function () {
    if (game
        && game.state
        && game.state.state === "playing"
        && game.state.gameState.state === "question"
        && game.state.gameState.qState.state === "released-write"
    ) {
        var startTime = game.state.gameState.qState.startTime - room.serverOffset;
        var elapsed = Date.now() - startTime;
        var fraction = 1 - Math.min(Math.max(elapsed / 20000, 0), 1);

        answerTimer.style.width = (fraction * 100) + "%";
    } else {
        answerTimer.style.width = "0";
    }

    requestAnimationFrame(timerUpdater);
};
timerUpdater();