var transitionEndEventName = function () {
    var i,
        el = document.createElement('div'),
        transitions = {
            'transition':'transitionend',
            'OTransition':'otransitionend',  // oTransitionEnd in very old Opera
            'MozTransition':'transitionend',
            'WebkitTransition':'webkitTransitionEnd'
        };

    for (i in transitions) {
        if (transitions.hasOwnProperty(i) && el.style[i] !== undefined) {
            return transitions[i];
        }
    }

    //TODO: throw 'TransitionEnd event is not supported in this browser';
};

var connectSettingsButton = function () {
    var settingsTab = document.getElementById("SettingsTab");
    var settingsButton = document.getElementById("SettingsButton");
    var tabActive = false;

    settingsButton.addEventListener("click", function (e) {
        if (tabActive) {
            settingsTab.classList.remove("Active");
        }
        else {
            settingsTab.classList.add("Active");
            settingsTab.classList.remove("Hidden");
        }
        tabActive = !tabActive;
    });

    settingsTab.addEventListener(transitionEndEventName(), function (e) {
        if (!settingsTab.classList.contains("Active")) {
            settingsTab.classList.add("Hidden");
        }
    });
};

var connectNightModeButton = function () {
    var nightModeButton = document.getElementById("NightModeButton");
    var nightMode = false;

    nightModeButton.addEventListener("click", function (e) {
        var cookieString = "darkMode=%0;path=/;max-age=15552000;SameSite=Strict";
        if (nightMode) {
            nightModeButton.innerHTML =
                "<div><i class=\"fa fa-sun-o fa-2x fa-fw\"></i></div>";
            document.body.classList.remove("Dark");
            document.cookie = cookieString.replace("%0", "false");
        }
        else {
            nightModeButton.innerHTML =
                "<div><i class=\"fa fa-moon-o fa-2x fa-fw\"></i></div>";
            document.body.classList.add("Dark");
            document.cookie = cookieString.replace("%0", "true");
        }
        nightMode = !nightMode;
    });

    if (document.cookie.indexOf("darkMode=true") > -1) {
        nightModeButton.click();
    }
};

var connectSettingsToggles = function () {
    var settingsToggles = document.getElementsByClassName("SettingsHeader");

    var toggleFunction = function () {
        var settingsContainer = this.parentNode.getElementsByClassName(
            "SettingsContainer")[0];
        if (this.parentNode.classList.contains("open")) {
            this.parentNode.classList.remove("open");
            settingsContainer.style.maxHeight = "";
        }
        else {
            this.parentNode.classList.add("open");
            this.parentNode.classList.remove("HideChildren");

            settingsContainer.style.maxHeight =
                settingsContainer.scrollHeight + "px";

            // Easter Egg for people with long names
            var nameContainer = document.getElementsByClassName(
                "SettingsTabUserName")[0];
            if (nameContainer &&
                nameContainer.scrollWidth > nameContainer.clientWidth) {
                nameContainer.setAttribute("title",
                    "Congratulations! Your name is so long that we needed a scrollbar to fit it in!");
            }
        }
    };

    var transitionEndFunction = function () {
        if (!this.classList.contains("open")) {
            this.classList.add("HideChildren");
        }
    };

    for (i = 0; i < settingsToggles.length; i++) {
        settingsToggles[i].addEventListener("click", toggleFunction);
        settingsToggles[i].parentNode.addEventListener(
            transitionEndEventName(), transitionEndFunction);
    }
};

var connectLogInButton = function () {
    var logInButton = document.getElementById("LogInButton");
    if (logInButton) {
        logInButton.addEventListener("click", function (e) {
            var settingsTab = document.getElementById("SettingsTab");
            var settingsButton = document.getElementById("SettingsButton");

            var signInTab = document.getElementById("SignInComponent");
            var signInTabButton = signInTab.getElementsByClassName(
                "SettingsHeader")[0];

            var settingsTabIsOpen = settingsTab.classList.contains("Active");
            var signInTabIsDown = signInTab.classList.contains("open");

            if (!settingsTabIsOpen) {
                settingsButton.click();
            }

            if (!signInTabIsDown) {
                signInTabButton.click();
            }

            if (settingsTabIsOpen && signInTabIsDown) {
                var logButtons = document.getElementsByClassName("LogInButton");
                var i;

                for (i = 0; i < logButtons.length; i++) {
                    logButtons[i].classList.remove("emphasize");
                    logButtons[i].offsetWidth = logButtons[i].offsetWidth;
                    logButtons[i].classList.add("emphasize");
                }
            }
        });
    }
};

var parseCookies = function() {
    var pairs = document.cookie.split(";");
    var cookies = {};
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split("=");
        var key = (pair[0] + "").trim();
        var value = decodeURIComponent(pair.slice(1).join("="));

        cookies[key] = value;
    }
    return cookies;
};

var connectPreferredNameInput = function() {
    const input = document.getElementById("PreferredNameInput");
    if (!input) {
        return;
    }

    const cookies = parseCookies();
    if (cookies.preferredName) {
        input.value = cookies.preferredName;
    }

    input.addEventListener("change", function () {
        var cookieString = "preferredName=%0;path=/;max-age=15552000;SameSite=Strict";
        const value = input.value || '';
        document.cookie = cookieString.replace("%0", encodeURIComponent(value))
    });
};

connectSettingsButton();
connectNightModeButton();
connectSettingsToggles();
connectLogInButton();
connectPreferredNameInput();

document.getElementById("LoadingScreen").addEventListener(transitionEndEventName(), function () {
    document.getElementById("LoadingScreen").style.display = "none";
});

window.addEventListener("load", function () {
    document.body.classList.add("loaded");
});
