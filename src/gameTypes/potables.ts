import { User, Actor, GenericRoom } from "./generic";
import { extend, wrapper } from "../utils";
import * as sqlite3 from "sqlite3";
sqlite3.verbose();

const db = new sqlite3.Database(__dirname + "/../misc/jeopardy.db");
const MAX_PLAYERS = 10;
const SECOND = 1000;
const RELEASE_TIMEOUT = 6 * SECOND;
const ANSWER_TIMEOUT = 8 * SECOND;
const REVEAL_TIMEOUT = 2.5 * SECOND;
const END_TIMEOUT = 10 * SECOND;

interface PotablesActor extends Actor {
    isHost: boolean;
    score: number;
    _pstate: number;
}

interface PotablesSettings {
}

const ROUNDS = {
    first: "first",
    double: "double",
};

type Round = keyof typeof ROUNDS;

type Bank = {
    [K in keyof typeof ROUNDS]: Category[];
}

interface Category {
    id: number;
    name: string;
    questions: (Question|null)[];
}

interface Question {
    id: number;
    categoryId: number;
    prompt: string;
    answer: string;
    difficulty: number;
    airDate: string;
    flags: number;
}

type Board = {
    categoryName: string;
    questions: (number|null)[];
}[];

interface QStub {
    prompt: string;
    score: number;
    categoryNumber: number;
    questionNumber: number;
}

// States
interface WaitingState {
    state: "waiting";
    _reason?: string;
}
interface PreparingState {
    state: "preparing";
}
interface PlayingState {
    state: "playing";
    gameState: GameState;
}
type State = WaitingState | PreparingState | PlayingState;

// GameStates
interface BoardGameState {
    state: "board";
    round: Round;
    board: Board;
}
interface QuestionGameState {
    state: "question";
    round: Round;
    board: Board;
    qState: QState;
}
interface EndGameState {
    state: "end";
}
type GameState = BoardGameState | QuestionGameState | EndGameState;

// QStates
interface ReadingQState {
    state: "reading";
    question: QStub;
}
interface ReleasedQState {
    state: "released";
    question: QStub;
    startTime: number;
    hasAnswered: { [authId: string]: Boolean };
}
interface AnsweringQState {
    state: "answering";
    question: QStub;
    startTime: number;
    answerer: string;
    hasAnswered: { [authId: string]: Boolean };
}
interface RevealQState {
    state: "reveal";
    question: QStub;
    answer: string;
}
type QState = ReadingQState | ReleasedQState | AnsweringQState | RevealQState;

export class PotablesRoom extends GenericRoom {
    room: {
        info(...args: any[]);
        debug(...args: any[]);

        emit(name: string, ...args: any[]);
        emitToUser(authId: string, name: string, ...args: any[]);
        broadcast(socket: any, name: string, ...args: any[]);
        disconnectUser(authId: string);
        
        data: {
            actors: PotablesActor[];
            state: State;

            currentRoundSettings: PotablesSettings;
            nextRoundSettings: PotablesSettings;
        };
        actorsByAuthId: {
            [authId: string]: PotablesActor
        };
    };

    state: State;
    bank?: Bank;
    lock: boolean;
    timeouts: {
        release?: NodeJS.Timer;
        board?: NodeJS.Timer;
        answer?: NodeJS.Timer;
        hostLeft?: NodeJS.Timer;
        end?: NodeJS.Timer;
    }

    constructor(room: any) {
        super(room);

        room.type = "potables";
        this.state = { state: "waiting" };
        this.timeouts = {};
        this.lock = false;
    }

    async getCategories(n: number): Promise<{categoryId: number, name: string}[]> {
        n = n || 12;
        let categories = await wrapper(db, db.all,
            "SELECT category_id, name FROM categories " +
            "WHERE valid = 1 ORDER BY random() LIMIT ?", n);
        let result: {categoryId: number, name: string}[] = [];
        for (let i of categories) {
            result.push({
                categoryId: i.category_id,
                name: i.name,
            });
        }
        return result;
    }

    async getCategoryById(cat_id: number): Promise<{categoryId: number, name: string}> {
        let categories = await wrapper(db, db.all,
            "SELECT category_id, name FROM categories " +
            "WHERE valid = 1 AND category_id = ? ORDER BY random() LIMIT 1", cat_id);

        if (categories.length === 0) {
            throw "No categories returned!";
        }

        return {
            categoryId: categories[0].category_id,
            name: categories[0].name,
        };
    }

    async getQuestion(categoryId: number, difficulty: number): Promise<Question> {
        let questions = await wrapper(db, db.all,
            "SELECT question_id, category_id, prompt, answer, " +
            "difficulty, air_date, flags FROM questions " +
            "WHERE category_id = ? AND difficulty = ? " +
            "ORDER BY random() LIMIT 1;", [categoryId, difficulty]);
        if (questions.length === 0) {
            throw `No questions found (${categoryId}, ${difficulty})`;
        }
        let q = questions[0];

        return {
            id: q.question_id,
            categoryId: q.category_id,
            prompt: q.prompt,
            answer: q.answer,
            difficulty: q.difficulty,
            airDate: q.air_date,
            flags: q.flags,
        };
    }

    async getQuestionsForCategory(categoryId: number): Promise<(Question|null)[]> {
        let questions : (Question|null)[] = [];
        for (let diff = 0; diff < 5; diff++) {
            let question;
            try {
                question = await this.getQuestion(categoryId, diff);
            }
            catch (e) {
                question = null;
            }

            questions.push(question);
        }

        return questions;
    }

    async flagQuestion(questionId: number) {
        return await wrapper(db, db.run,
            "UPDATE questions SET flags = flags + 1" +
            "WHERE question_id = ? AND flags >= 0;", questionId);
    }

    async prepareGame(): Promise<Bank> {
        let stubs = await this.getCategories(12);

        let categories: Category[] = [];
        for (let i of stubs) {
            let qs = await this.getQuestionsForCategory(i.categoryId);
            categories.push({
                id: i.categoryId,
                name: i.name,
                questions: qs,
            });
        }

        return {
            first: categories.slice(0, 6),
            double: categories.slice(6),
        };
    }

    makeBoard(categories: Category[], round: Round): Board {
        let multipler: number;
        switch (round) {
            case "first": multipler = 200; break;
            case "double": multipler = 400; break;
            default: multipler = 0; break;
        }

        return categories.map((i) => {
            return {
                categoryName: i.name,
                questions: i.questions.map((q) => {
                    return this.calculateScore(round, q);
                }),
            };
        });
    }

    dataObj(): any {
        return super.dataObj();
    }
    defaultRoundSettings() {
        return {};
    }

    newActor(user: User) {
        return extend(super.newActor(user), {
            isHost: false,
            score: 0,
            _pstate: 0,
        });
    }

    addUser(socket, user: User) {
        super.addUser(socket, user);

        let room = this.room;
        let game = this;

        room.emitToUser(user.authId, "setState", game.state);

        // If it is the host, resend a copy of the bank
        if (room.actorsByAuthId[user.authId] &&
            room.actorsByAuthId[user.authId].isHost &&
            game.state.state !== "waiting") {
                room.emitToUser(user.authId, "bank", game.bank);

                // also, clear the host left timeout if it's the host
                if (this.timeouts.hostLeft)
                    clearTimeout(this.timeouts.hostLeft);
        }

        socket.on("drawingJoin", (paths) => {
            this.join(user, { drawing: paths });
        });

        socket.on("prepareGame", () => {
        });

        socket.on("rerollCategory", (round, categoryNumber) => {
            if (game.state.state !== "preparing") return;
            if (game.lock) return;
            if (!room.actorsByAuthId[user.authId].isHost) return;
            if (categoryNumber < 0 || categoryNumber >= 6) return;
            if (ROUNDS[round] == null) return;

            let r = round as Round;
            let catNum = (categoryNumber as number) | 0;
            game.lock = true;

            let category: { categoryId: number, name: string };
            game.getCategories(1)
                .then((data) => {
                    category = data[0];
                    return game.getQuestionsForCategory(category.categoryId);
                })
                .then((questions) => {
                    if (game.state.state !== "preparing") return;
                    if (game.bank == null) return;
                    if (!game.lock) return
                    game.lock = false;

                    game.bank[r][catNum] = {
                        name: category.name,
                        id: category.categoryId,
                        questions: questions
                    };

                    room.emitToUser(user.authId, "bank", game.bank);
                })
                .catch((e) => {
                    game.databaseError(e);
                });
        });

        socket.on("trySetCategory", (round, categoryNumber, categoryId) => {
            if (game.state.state !== "preparing") return;
            if (game.lock) return;
            if (!room.actorsByAuthId[user.authId].isHost) return;
            if (categoryNumber < 0 || categoryNumber >= 6) return;
            if (ROUNDS[round] == null) return;
            if (typeof categoryId !== "number") return;

            let r = round as Round;
            let catNum = (categoryNumber as number) | 0;
            game.lock = true;

            let category: { categoryId: number, name: string };
            game.getCategoryById(categoryId)
                .then((data) => {
                    category = data;
                    return game.getQuestionsForCategory(data.categoryId);
                })
                .then((questions) => {
                    if (game.state.state !== "preparing") return;
                    if (game.bank == null) return;
                    if (!game.lock) return
                    game.lock = false;

                    game.bank[r][catNum] = {
                        name: category.name,
                        id: category.categoryId,
                        questions: questions
                    };

                    room.emitToUser(user.authId, "bank", game.bank);
                })
                .catch((e) => {
                    game.lock = false;
                });
        });

        socket.on("rerollQuestion", (round, categoryNumber, questionNumber) => {
            if (game.state.state !== "preparing") return;
            if (game.lock) return;
            if (game.bank == null) return;
            if (!room.actorsByAuthId[user.authId].isHost) return;
            if (categoryNumber < 0 || categoryNumber >= 6) return;
            if (questionNumber < 0 || questionNumber >= 5) return;
            if (ROUNDS[round] == null) return;

            let r = round as Round;
            let catNum = (categoryNumber as number) | 0;
            let qNum = (questionNumber as number) | 0;
            game.lock = true;
            
            let category = game.bank[r][catNum];

            game.getQuestion(category.id, qNum)
                .then((question) => {
                    if (game.state.state !== "preparing") return;
                    if (game.bank == null) return;
                    if (!game.lock) return
                    game.lock = false;

                    game.bank[r][catNum].questions[qNum] = question;

                    room.emitToUser(user.authId, "bank", game.bank);
                })
                .catch((e) => {
                    game.databaseError(e);
                });
        });

        socket.on("startGame", () => {
            let actor = room.actorsByAuthId[user.authId];
            if (!actor) return;
            if (!actor.isHost) return;
            if (room.data.actors.length < 3) return;
            if (game.state.state !== "preparing") return;
            if (game.bank == null) return;
            if (game.lock) return;

            game.state = {
                state: "playing",
                gameState: {
                    state: "board",
                    round: "first",
                    board: this.makeBoard(game.bank.first, "first"),
                },
            };
            game.sendState();

            room.emit("effect:fillBoard");
        });

        socket.on("selectQuestion", (categoryNumber, questionNumber) => {
            if (game.state.state !== "playing") return;
            if (game.state.gameState.state !== "board") return;
            if (!room.actorsByAuthId[user.authId].isHost) return;
            if (categoryNumber < 0 || categoryNumber >= 6) return;
            if (questionNumber < 0 || questionNumber >= 5) return;

            let c = (categoryNumber as number) | 0;
            let q = (questionNumber as number) | 0;

            if (game.bank == null)
                throw `game.bank is null when playing`;

            let question = game.bank[game.state.gameState.round][c]
                .questions[q];
            if (question == null) return;

            let gs = game.state.gameState;

            game.state.gameState = {
                state: "question",
                round: gs.round,
                board: gs.board,
                qState: {
                    state: "reading",
                    question: {
                        prompt: question.prompt,
                        // force because if question is not null calculateScore
                        // cannot be null
                        score: game.calculateScore(gs.round, question) as number,
                        categoryNumber: c,
                        questionNumber: q,
                    }
                }
            };
            game.sendState();
        });

        socket.on("release", () => {
            let actor = room.actorsByAuthId[user.authId];
            if (!actor) return;
            if (!actor.isHost) return;
            if (game.state.state !== "playing") return;
            if (game.state.gameState.state !== "question") return;
            if (game.state.gameState.qState.state !== "reading") return;
            
            let qs = game.state.gameState.qState;
            game.state.gameState.qState = {
                state: "released",
                question: qs.question,
                startTime: Date.now(),
                hasAnswered: {},
            };
            game.sendState();

            game.timeouts.release = setTimeout(() => {
                game.revealQuestion();
                room.emit("effect:timeout");
            }, RELEASE_TIMEOUT);
        });

        socket.on("buzz", () => {
            let actor = room.actorsByAuthId[user.authId];
            if (!actor) return;
            if (actor.isHost) return;
            if (game.state.state !== "playing") return;
            if (game.state.gameState.state !== "question") return;
            if (game.state.gameState.qState.state === "reading") {
                actor.score -= ++actor._pstate;
                room.emit("setScore", {
                    authId: actor.authId,
                    score: actor.score,
                });
                return;
            }
            if (game.state.gameState.qState.state !== "released") return;
            if (game.state.gameState.qState.hasAnswered[user.authId]) return;

            // stop the release timeout
            if (game.timeouts.release)
                clearTimeout(game.timeouts.release);
            
            let gs = game.state.gameState;
            let qState = game.state.gameState.qState;
            qState.hasAnswered[actor.authId] = true;

            gs.qState = {
                state: "answering",
                question: gs.qState.question,
                startTime: Date.now(),
                answerer: actor.authId,
                hasAnswered: qState.hasAnswered,
            };

            game.timeouts.answer = setTimeout(() => {
                game.answerFail();
            }, ANSWER_TIMEOUT);

            game.sendState();
        });

        socket.on("validate", (correct) => {
            let actor = room.actorsByAuthId[user.authId];
            if (!actor) return;
            if (!actor.isHost) return;
            if (game.state.state !== "playing") return;
            if (game.state.gameState.state !== "question") return;
            if (game.state.gameState.qState.state !== "answering") return;
            
            if (game.timeouts.answer)
                clearTimeout(game.timeouts.answer);
            
            if (correct) {
                game.answerSuccess();
            }
            else {
                game.answerFail();
            }
        });

        socket.on("setScore", (event) => {
            let actor = room.actorsByAuthId[user.authId];
            if (!actor) return;
            if (!actor.isHost) return;
            if (game.state.state !== "playing") return;

            let target = room.actorsByAuthId[event.authId];
            let score = event.score;

            if (target && score != null) {
                let prev = target.score;
                target.score = score | 0;
                if (prev === target.score) {
                    return;
                }

                room.emit("setScore", {
                    authId: target.authId,
                    score: target.score,
                });
                room.emit("hostSetScore", {
                    authId: target.authId,
                    before: prev,
                    after: target.score,
                });
            }
        });

        socket.on("skipQuestion", () => {
            let actor = room.actorsByAuthId[user.authId];
            if (!actor) return;
            if (!actor.isHost) return;
            if (game.state.state !== "playing") return;
            if (game.state.gameState.state !== "question") return;

            if (this.timeouts.answer)
                clearTimeout(this.timeouts.answer);

            if (this.timeouts.board)
                clearTimeout(this.timeouts.board);
            
            if (this.timeouts.release)
                clearTimeout(this.timeouts.release);

            game.removeQuestion(game.state.gameState.qState.question);
        });
    }

    revealQuestion() {
        if (this.state.state === "playing" &&
            this.state.gameState.state == "question" &&
            this.bank != null) {
                let gs = this.state.gameState;
                let qStub = gs.qState.question;
                let question = this.bank[gs.round]
                    [qStub.categoryNumber].questions[qStub.questionNumber] as Question;
                
                gs.qState = {
                    state: "reveal",
                    question: qStub,
                    answer: question.answer,
                }

                this.sendState();

                this.timeouts.board = setTimeout(() => {
                    this.removeQuestion(qStub);
                }, REVEAL_TIMEOUT);
        }
        else {
            throw "Invalid state to call revealQuestion in";
        }
    }

    removeQuestion(question: QStub) {
        if (this.state.state !== "playing" ||
            this.state.gameState.state === "end" ||
            this.bank == null) {
                throw "Invalid state to call removeQuestion in";
        }
        else {
            this.state.gameState = {
                state: "board",
                round: this.state.gameState.round,
                board: this.state.gameState.board,
            };

            let board = this.state.gameState.board;
            board[question.categoryNumber].questions[question.questionNumber] = null;

            let empty = this.boardIsEmpty();
            if (empty) {
                switch (this.state.gameState.round) {
                    case "first":
                        this.state.gameState = {
                            state: "board",
                            round: "double",
                            board: this.makeBoard(this.bank["double"], "double"),
                        };
                        break;
                    case "double":
                        this.state.gameState = {
                            state: "end",
                        }
                        this.room.emit("effect:end");
                        this.timeouts.end = setTimeout(() => {
                            this.endGame();
                        }, END_TIMEOUT);
                        break;
                }
            }

            this.sendState();
        }
    }

    answerSuccess() {
        if (this.state.state !== "playing" ||
            this.state.gameState.state !== "question" ||
            this.state.gameState.qState.state !== "answering") {
                throw "Invalid state to call answerSuccess in";
        }
        else {
            let qStub = this.state.gameState.qState.question;
            let authId = this.state.gameState.qState.answerer;
            let actor = this.room.actorsByAuthId[authId];
            
            actor.score += qStub.score;
            this.room.emit("setScore", {
                authId: actor.authId,
                score: actor.score,
            });

            this.removeQuestion(qStub);

            this.room.emit("effect:correct");
        }
    }

    answerFail() {
        if (this.state.state !== "playing" ||
            this.state.gameState.state !== "question" ||
            this.state.gameState.qState.state !== "answering") {
                throw "Invalid state to call answerFail in";
        }
        else {
            let qStub = this.state.gameState.qState.question;
            let authId = this.state.gameState.qState.answerer;
            let actor = this.room.actorsByAuthId[authId];
            
            actor.score -= qStub.score;
            this.room.emit("setScore", {
                authId: actor.authId,
                score: actor.score,
            });

            let qs = this.state.gameState.qState;

            var allFailed = true;
            for (var i in this.room.actorsByAuthId) {
                if (!qs.hasAnswered[i] && !this.room.actorsByAuthId[i].isHost) {
                    allFailed = false;
                    break;
                }
            }

            if (allFailed) {
                this.revealQuestion();
            }
            else {
                this.state.gameState.qState = {
                    state: "released",
                    question: qs.question,
                    startTime: Date.now(),
                    hasAnswered: qs.hasAnswered,
                };
                this.sendState();

                this.timeouts.release = setTimeout(() => {
                    this.revealQuestion();
                    this.room.emit("effect:timeout");
                }, RELEASE_TIMEOUT);
            }

            this.room.emit("effect:incorrect");
        }
    }

    boardIsEmpty(): boolean {
        if (this.state.state !== "playing" ||
            this.state.gameState.state === "end") {
                return false;
        }

        for (let i of this.state.gameState.board) {
            for (let j of i.questions) {
                if (j != null) {
                    return false;
                }
            }
        }

        return true;
    }

    calculateScore(round: Round, question: Question | null): number | null {
        if (question == null) {
            return null;
        }

        switch (round) {
            case "first": return 200 * (question.difficulty + 1);
            case "double": return 400 * (question.difficulty + 1);
        }
    }

    databaseError(e) {
        this.room.info(e);
        this.room.emit("databaseError");
        // TODO: decide if this is a good idea
        this.state = { state: "waiting", _reason: "databaseError" };
        this.sendState();
        this.cleanUp();
    }

    join(user: User, options?: any) {
        let room = this.room;

        if (room.data.actors.length >= MAX_PLAYERS + 1)
            return;

        if (this.state.state === "playing" &&
            this.state.gameState.state === "end")
                return;

        let setHost = room.data.actors.length === 0;

        if (!setHost && this.state.state === "waiting")
            return;

        super.join(user, extend(options, { isHost: setHost }));
        
        if (setHost) {
            this.state = { state: "preparing" };
            this.sendState();

            this.state = {
                state: "preparing",
            };
            this.sendState();
            this.lock = true;

            this.prepareGame()
                .then((data) => {
                    if (this.state.state !== "preparing") return;
                    if (!this.lock) return
                    this.lock = false;

                    this.bank = data;
                    room.emitToUser(user.authId, "bank", data);
                })
                .catch((e) => {
                    this.databaseError(e);
                });
        }
    }

    leave(actor: PotablesActor) {
        let room = this.room;

        if (this.state.state === "waiting") {
            super.leave(actor);
            if (actor.isHost) {
                this.room.emit("hostLeft");
                this.sendState();
                this.cleanUp();
            }
        }
        else if (this.state.state === "preparing") {
            super.leave(actor);
            if (actor.isHost) {
                this.room.emit("hostLeft");
                this.state = { state: "waiting", _reason: "preparingHostLeft" };
                this.sendState();
                this.cleanUp();
            }
        }
        else if (actor.isHost) {
            this.room.emit("hostLeft");
            this.timeouts.hostLeft = setTimeout(() => {
                this.state = { state: "waiting", _reason: "playingHostLeft" };
                this.sendState();
                this.cleanUp();
            }, 60 * 1000);
        }
        else {
            // Can rejoin if disconnected otherwise
        }
    }

    sendState() {
        this.room.emit("setState", this.state);
    }

    endGame() {
        this.cleanUp();
        this.state = { state: "waiting" };
        this.sendState();
    }

    cleanUp() {
        for (let i in this.timeouts) {
            clearTimeout(this.timeouts[i]);
        }
        this.timeouts = {};

        this.room.emit("clearActors");
        this.lock = false;

        super.cleanUp();
    }

    deconstruct() {
        for (let i in this.timeouts) {
            clearTimeout(this.timeouts[i]);
        }

        super.deconstruct();
    }
}

export default PotablesRoom;
