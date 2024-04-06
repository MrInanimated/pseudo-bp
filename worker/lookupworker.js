/* jshint node: true*/
/* jshint esnext: true*/
var redis = require("redis");
var fs = require("fs");

var redisConfig = require("../build/config/redis.js");
var pubClient = redis.createClient(
    redisConfig.port, redisConfig.host, redisConfig.options
);
var subClient = redis.createClient(
    redisConfig.port, redisConfig.host, redisConfig.options
);

var loadDictionary = function (filename) {
    var data = fs.readFileSync(filename);
    return data.toString().split(/\r?\n/g).filter(function (w) {
        return /^[a-z]+$/.test(w);
    }).sort();
};

var dictionaries = {
    "en": loadDictionary(__dirname + "/../build/dictionaries/english.txt"),
    "en-CL": loadDictionary(__dirname + "/../build/dictionaries/classic.txt"),
    "en-BP": loadDictionary(__dirname + "/../build/dictionaries/bombparty.txt"),
    "markov": loadDictionary(__dirname + "/../build/dictionaries/markov.txt"),
};

subClient.on("message", function (channel, message) {
    if (channel == "dictionary-query") {
        query = JSON.parse(message);
        console.log(query);
        handleQuery(query);
    }
});
subClient.subscribe("dictionary-query");

function sendResults(results) {
    pubClient.publish("dictionary-results", JSON.stringify(results));
}

function handleQuery(query) {
    query = query || {};
    var words = dictionaries[query.dictionary || "en"];

    var prompts = query.prompts || [];
    var begins = query.begins || "";
    var ends = query.ends || "";

    var regex;
    if (query.regex) {
        try {
            regex = new RegExp(query.regex);
        }
        catch (e) { }
    }

    words = words.filter(function (i) {
        if (!prompts.every(j => i.includes(j)))
            return false;

        if (!i.startsWith(begins))
            return false;

        if (!i.endsWith(ends))
            return false;

        if (query.minLength && i.length < query.minLength)
            return false;

        if (!isNaN(query.maxLength) && i.length > query.maxLength)
            return false;

        if (regex && !regex.test(i))
            return false;

        return true;
    });

    var number = Math.min(query.number || 20, 50);

    results = sample(words, number);

    sendResults({
        type: "result",
        data: {
            number: words.length,
            words: results,
        },
        id: query.id,
    });
}

function sample(array, number) {
    var result = [];
    number = Math.min(array.length, number);

    for (var i = 0; i < number; i++) {
        var index = Math.random() * (array.length - i) | 0;
        var chosen = array[index];
        result.push(chosen);

        array[index] = array[array.length - i - 1];
        array[array.length - i - 1] = chosen;
    }

    return result;
}

console.log("ready");
