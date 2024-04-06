/* jshint node:true*/
/* jshint esnext:true*/

// ./dictionaries.js
//
// This file contains all the different types of dictionaries, and their associated
// functions.
//
// Right now these don't get a huge amount of use because I haven't had a way to filter them yet
//
// The dicts object should contain a set of constructors for different dictionaries.
// All constructor objects must have the newDict method, which returns an actual
// dictionary object.
//
// A dictionary object must have three methods:
// generatePrompt, which returns a randomly chosen prompt
// useWord, which makes the dictionary object register internally somewhere that a word has been used
// checkWord, which returns a boolean indicating whether a word is valid or not
//
// The way the dictionary objects and constructor are used is as thus:
// game.server.js initiates an instance of each of the constructor objects (top level objects in the dicts object)
// Whenever a new game starts, game.room.js calls upon the .newDict() method of its desired dictionary constructor
//
// The actual dictionary objects are discarded and regenerated every round
// So it's important for them to be lightweight

var
    dicts = module.exports = {};

var scrabbleScores = {
    e: 1,
    a: 1,
    i: 1,
    o: 1,
    n: 1,
    r: 1,
    t: 1,
    l: 1,
    s: 1,
    u: 1,
    d: 2,
    g: 2,
    b: 3,
    c: 3,
    m: 3,
    p: 3,
    f: 4,
    h: 4,
    v: 4,
    w: 4,
    y: 4,
    k: 5,
    j: 8,
    x: 8,
    q: 10,
    z: 10,
};

var precomputed = require("./dictionaries/precomputed.json");

// The NormalDict dictionary *constructor*
// Yes this is a constructor for an object that acts as a constructor for another object
// Would the appropriate term for this be a factory?
dicts.Normal = function (wordList, name) {
    this.wordList = wordList.slice();
    this.wordList.sort();

    // Look up table for prompt bonuses
    this.promptFrequencies = precomputed[name].promptFrequencies;

    this.prompts = precomputed[name].prompts;
};

// newDict method of the NormalDict constructor
dicts.Normal.prototype.newDict = function () {
    return new NormalDict(this);
};

// The actual NormalDict dictionary *object*
var NormalDict = function (parent) {
    // We only use a reference to wordList here
    // because memory usage
    this.wordList = parent.wordList;
    this.promptFrequencies = parent.promptFrequencies;
    this.prompts = parent.prompts;

    // Since javascript doesn't have anything like sets
    // I've just abused how associative arrays' keys are hashed
    // And treated this.usedWords as a set
    this.usedWords = {};
};

// generatePrompt method of NormalDict
NormalDict.prototype.generatePrompt = function (minLength, maxLength, difficulty) {
    // Choose a random prompt length between 2 and maxLength
    var promptLength = minLength + (Math.random() * (maxLength - minLength + 1) | 0);

    if (difficulty === 2) {
        // hard mode
        // just choose a prompt uniformly out of possible prompts

        return this.prompts[promptLength][Math.random() * this.prompts[promptLength].length | 0];

    }
    else if (difficulty === 3) {
        // masochistic mode
        // choose a prompt uniformly out of the last half of possible prompts

        var hardThreshold = 0.75;

        var starting = Math.floor(this.prompts[promptLength].length * hardThreshold);
        var range = this.prompts[promptLength].length - starting;

        return this.prompts[promptLength][starting + Math.random() * range | 0];

    }
    else {

        // Alright, I best explain what this is doing
        // This code attempts to choose a word that's not been used
        // Because if it doesn't, it can guarantee that the generated prompt
        // is not impossible.

        // I've tried several ways of doing this, but all of them took too much
        // memory or processing time, so I've just decided to go with the simplest
        // approach: just keep choosing a random word until you get one that's not
        // been used before.

        // It's not pretty, but there are roughly 273K words in the dictionary
        // And any one point, what, like, 100-2000 of them are going to be used?
        // The probability of choosing an already used word is mindbogglingly tiny
        // And so I decided to go with this method

        // Basically, this just tries to choose a word for a maximum of 100 times
        // (so as to not lock up the server if we're especially unlucky)
        // And if it doesn't find a word it can use, it says "Too bad"

        var maxAttempts = 100;
        var easyThreshold = 100;

        var prompt = "es";  // fallback value if somehow it doesn't successfully find a prompt after 100 tries
        // the chances of that are astronomically low btw

        var chosenWord, chosenIndex;
        for (var attempts = 1; attempts < maxAttempts; attempts++) {
            chosenWord = this.wordList[Math.random() * this.wordList.length | 0];

            if (this.usedWords[chosenWord]) continue;
            if (chosenWord.length < promptLength) continue;

            chosenIndex = Math.random() * Math.max(0, chosenWord.length - promptLength);
            prompt = chosenWord.slice(chosenIndex, chosenIndex + promptLength);

            if (difficulty === 0 && this.promptFrequencies[prompt.length][prompt] < easyThreshold) continue;

            break;
        }

        return prompt;
    }

};

// useWord method for NormalDict
NormalDict.prototype.useWord = function (word) {
    // We're abusing usedWords to be a hash
    // And so we just set it as 1 because Javascript considers 1 to be a
    // true-y value
    this.usedWords[word] = 1;
};

// checkWord method for NormalDict
NormalDict.prototype.checkWord = function (word) {
    // Return false if the word's already been used
    if (this.usedWords[word]) {
        return false;
    }
    /*
    // Make sphenopalatine ganglioneuralgia work
    if (word === "sphenopalatine ganglioneuralgia") {
        return true;
    }
    */
    // return true if word is in dictionary, false otherwise
    return binarySearch(this.wordList, word) > -1;
};

// score a word
NormalDict.prototype.scoreWord = function (word, prompt) {
    var scrabbleBonus = 0;
    for (var l of word) {
        if (scrabbleScores[l])
            scrabbleBonus += scrabbleScores[l];
    }

    var promptBonus = this.promptFrequencies[prompt.length][prompt];
    promptBonus = promptBonus ?  Math.round(20 - 11 / 6 * Math.log(promptBonus)) : 0;

    var lengthBonus = Math.min(word.length, 15);
    scrabbleBonus = Math.min(scrabbleBonus, 30);

    return promptBonus + scrabbleBonus + lengthBonus;
};

NormalDict.prototype.scorePrompt = function (prompt) {
    var bonus = this.promptFrequencies[prompt.length][prompt];
    if (!bonus) return 0;

    return Math.max(1, Math.round(20 - 11/6 * Math.log(bonus)));
};

// Just a binary search algorithm
// Don't worry about this
var binarySearch = function (array, element, start, end) {
    start = start || 0;
    end = end || array.length - 1;

    var currentIndex;
    var currentElement;

    while (start <= end) {
        currentIndex = (start + end) / 2 | 0;
        currentElement = array[currentIndex];

        if (currentElement < element) {
            start = currentIndex + 1;
        }
        else if (currentElement > element) {
            end = currentIndex - 1;
        }
        else {
            return currentIndex;
        }
    }

    return -1;
};

// JQXZ dictionary constructor
// This works, but I've not implemented anything to switch to this
// dictionary yet
dicts.JQXZ = function (wordList, name) {
    wordList = wordList.filter(function (i) {
        return i.search(/[jqxz]/) > -1;
    });

    dicts.Normal.call(this, wordList, name);
};

// I don't even think you need this line
dicts.JQXZ.prototype = dicts.Normal.prototype;

// Ness dictionary constructor
dicts.Ness = function (wordList, name) {
    wordList = wordList.filter(function (i) {
        return i.search("ness") > -1;
    });

    dicts.Normal.call(this, wordList, name);
};

dicts.Ness.prototype = dicts.Normal.prototype;

dicts.Unique = function (wordList) {
    this.wordList = wordList.slice();

    var data = require("fs").readFileSync(__dirname + "/dictionaries/uniqueprompts.txt");
    this.prompts = data.toString().split(/\r?\n/g).filter(i => i.length).sort();
};

dicts.Unique.prototype.newDict = function () {
    return new UniqueDict(this);
};

var UniqueDict = function (parent) {
    this.wordList = parent.wordList;
    this.prompts = parent.prompts;

    this.usedPrompts = {};
};

UniqueDict.prototype.generatePrompt = function () {
    var maxAttempts = 100;

    var prompt = "svi";
    for (; maxAttempts >= 0; maxAttempts--) {
        prompt = this.prompts[this.prompts.length * Math.random() | 0];
        if (!this.usedPrompts[prompt]) {
            break;
        }
    }

    this.usedPrompts[prompt] = 1;
    return prompt;
};

UniqueDict.prototype.useWord = function (word) {

};

UniqueDict.prototype.checkWord = function (word) {
    return binarySearch(this.wordList, word) > -1;
};

UniqueDict.prototype.scoreWord = function () {
    return 20;
};

UniqueDict.prototype.scorePrompt = function () {
    return 20;
};

dicts.Single = function (wordList, name) {
    this.wordList = wordList.slice();

    dicts.Normal.call(this, wordList, name);
}

dicts.Single.prototype.newDict = function () {
    return new SingleDict(this);
}

var SingleDict = function (parent) {
    NormalDict.call(this, parent);

    this.setPrompt = null;
}

SingleDict.prototype = Object.create(NormalDict.prototype, {
    generatePrompt: {
        value: function (minLength, maxLength, difficulty) {
            if (this.setPrompt == null) {
                this.setPrompt = NormalDict.prototype.generatePrompt.call(this, minLength, maxLength, difficulty);
            }
            return this.setPrompt;
        },
        enumerable: true,
        configurable: true,
        writable: true,
    },
});

/*
    Hmm
    Not sure where I was going with this actually

dicts.Regex = function (wordList) {
    this.wordList = wordList.slice();
    wordList.sort();
};

var RegexDict = function (parent) {
    this.wordList = parent.wordList;
    this.usedWords = {};
};

RegexDict.prototype.generatePrompt = function (minLength, maxLength, difficulty) {
    // TODO
};

RegexDict.prototype.useWord = function (word) {
    this.usedWords[word] = 1;
};

RegexDict.prototype.checkWord = function (word) {
    if (this.usedWords[word]) {
        return false;
    }

    return binarySearch(this.wordList, word) > -1;
};

RegexDict.prototype.scoreWord = function (word, prompt) {
    return 1;
};

RegexDict.prototype.scorePrompt = function (prompt) {
    return 1;
};
*/

/*
    This is a failed experiment
    Don't look at this pls

dicts.Serialized = function (wordList) {
    console.time("loadSerialized");

    this.wordSet = {};
    this.prompts = {};
    this.totalPrompts = 0;
    this.promptRange = [2, 5];

    for (var i = 0; i < wordList.length; i++) {
        var word = wordList[i];
        this.wordSet[word] = 1;

        for (var j = this.promptRange[0]; j <= this.promptRange[1]; j++) {
            for (var k = 0; k < word.length - j + 1; k++) {
                var sub = word.slice(k, k + j);
                if (this.prompts[sub])
                    this.prompts[sub]++;
                else
                    this.prompts[sub] = 1;

                this.totalPrompts++;
            }
        }
    }

    console.timeEnd("loadSerialized");

    console.log(this.totalPrompts);
};

dicts.Serialized.prototype.newDict = function () {
    var vars = {};
    vars.wordSet = this.wordSet;
    vars.prompts = {};
    for (var i in this.prompts) {
        vars.prompts[i] = this.prompts[i];
    }
    vars.totalPrompts = this.totalPrompts;
    vars.promptRange = this.promptRange;
    vars.usedWords = {};

    return new SerializedDict(vars);
};

var SerializedDict = function (vars) {
    for (var i in vars) {
        this[i] = vars[i];
    }
};

SerializedDict.prototype.generatePrompt = function () {
    var ind = Math.random() * this.totalPrompts << 0;
    for (var i in this.prompts) {
        if (ind < this.prompts[i]) {
            return i;
        }
        else {
            ind -= this.prompts[i];
        }
    }
    return "we've run out of words, sorry!";
};

SerializedDict.prototype.useWord = function (word) {
    this.usedWords[word] = 1;
    for (var i = this.promptRange[0]; i <= this.promptRange[1]; i++) {
        for (var j = 0; j < word.length - i + 1; j++) {
            var sub = word.slice(j, j + i);
            if (this.prompts[sub]) {
                this.prompts[sub]--;
                this.totalPrompts--;
            }
        }
    }
};

SerializedDict.prototype.checkWord = function (word) {
    return this.wordSet[word] && !this.usedWords[word];
};

dicts.JQV = function (wordList) {
    console.time("loadJQV");

    wordList = wordList.filter(function (i) {
        return i.search(/[jqv]/) > -1;
    });

    dicts.Serialized.call(this, wordList);

    console.timeEnd("loadJQV");
};

dicts.JQV.prototype = dicts.Serialized.prototype;
*/
