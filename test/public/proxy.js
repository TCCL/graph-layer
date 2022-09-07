// proxy.js

(function(){
    function onMakeRequestClick(event) {
        function onReadyStateChanged() {
            if (xhr.readyState == XMLHttpRequest.DONE) {
                const params = {};

                if (proxyInfo.sessionId) {
                    params["isAnonymousRequest"] = false;
                    params["isUserRequest"] = true;
                    params["sessionId"] = proxyInfo.sessionId;
                }
                else {
                    params["isAnonymousRequest"] = true;
                    params["isUserRequest"] = false;
                    params["appId"] = proxyInfo.appId;
                }

                requestConsoleElem.textContent = "GET " + url + "\r\n" + JSON.stringify(params,null,2);

                var result = JSON.parse(xhr.response.toString());
                responseConsoleElem.textContent = "HTTP " + xhr.status + "\r\n" + JSON.stringify(result,null,2);
            }
        }

        if (!proxyInfo.hasUserSession) {
            requestConsoleElem.innerText = "Cannot perform request: user session does not exist.";
            return;
        }

        var xhr = new XMLHttpRequest();
        var url = proxyInfo.endpoint + "/me";

        xhr.addEventListener("readystatechange",onReadyStateChanged);
        xhr.open("GET",url);
        if (proxyInfo.appId) {
            xhr.setRequestHeader("X-Graph-Layer-Anonymous",proxyInfo.appId);
        }
        xhr.send();
    }

    function onResetClick(event) {
        requestConsoleElem.innerText = "";
        responseConsoleElem.innerText = "";
    }

    var calloutElem = document.getElementById("graph-layer-test-callout");
    var requestConsoleElem = document.getElementById("graph-layer-test-proxy-request-console");
    var responseConsoleElem = document.getElementById("graph-layer-test-proxy-response-console");
    var makeRequestButtonElem = document.getElementById("graph-layer-test-proxy-button");
    var resetButtonElem = document.getElementById("graph-layer-test-reset-button");

    var proxyInfoElem = document.getElementById("graph-layer-test-proxy-info");
    var proxyInfo = JSON.parse(proxyInfoElem.innerText);

    if (!proxyInfo.hasUserSession) {
        calloutElem.innerText = "No user session detected. Please authenticate to run this test.";
    }

    makeRequestButtonElem.addEventListener("click",onMakeRequestClick);
    resetButtonElem.addEventListener("click",onResetClick);
})();
