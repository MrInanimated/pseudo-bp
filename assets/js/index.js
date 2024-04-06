window.onload = function () {
    document.getElementById("NewRoom").addEventListener("submit", function (e) {
        e.preventDefault();
        if (document.getElementById("NewRoomName").value !== "" &&
            ["play", "bpah", "type", "draw", "anti", "jeo"].indexOf(document.getElementById("NewRoomType").value) !== -1)
            window.location = "/" +
                document.getElementById("NewRoomType").value + "/" +
                document.getElementById("NewRoomName").value;
        else
            alert("Uh, your room name can't be empty." + "\n" +
                "Please enter another room name and try again.");
    });
};
