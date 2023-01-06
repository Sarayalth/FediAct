var browser, chrome, settings
const enableConsoleLog = false
const logPrepend = "[FediAct]"
const tokenInterval = 1 // minutes
const mutesApi = "/api/v1/mutes"
const blocksApi = "/api/v1/blocks"
const domainBlocksApi = "/api/v1/domain_blocks"
const appsApi = "/api/v1/apps"
const oauthAuthorizeApi = "/oauth/authorize"
const oauthTokenApi = "/oauth/token"
const oauthRevokeApi = "/oauth/revoke"
const timeout = 15000
// required settings keys with defauls
const settingsDefaults = {
	fediact_homeinstance: null,
    fediact_token: null,
    fediact_client_id: null,
    fediact_client_secret: null,
}

// wrapper to prepend to log messages
function log(text) {
	if (enableConsoleLog) {
		console.log(logPrepend + ' ' + text)
	}
}

// get redirect url (it will be the url on the toot authors home instance)
async function resolveExternalTootHome(url) {
    return new Promise(async function(resolve) {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => {
                log("Timed out")
                controller.abort()
            }, timeout)
            var res = await fetch(url, {method: 'HEAD', signal: controller.signal})
            clearTimeout(timeoutId)
            if (res.redirected) {
                resolve(res.url)
            } else {
                resolve(false)
            }
        } catch(e) {
            log(e)
            resolve(false)
        }
    })
}

// get redirect url (it will be the url on the toot authors home instance)
async function generalRequest(data) {
    return new Promise(async function(resolve) {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => {
                log("Timed out")
                controller.abort()
            }, timeout)
            if (data[3]) {
                // json body provided, post as body to target
                data[2]["User-Agent"] = "FediAct Service"
                data[2]["Content-Type"] = "application/json"
                var res = await fetch(data[1], {
                    method: data[0],
                    signal: controller.signal,
                    // if json body is provided, there is also header data
                    headers: data[2],
                    body: JSON.stringify(data[3])
                })
            } else if (data[2]) {
                // header data provided
                data[2]["User-Agent"] = "FediAct Service"
                var res = await fetch(data[1], {
                    method: data[0],
                    signal: controller.signal,
                    headers: data[2]
                })
            } else {
                var res = await fetch(data[1], {
                    method: data[0],
                    signal: controller.signal,
                    headers: {"User-Agent": "FediAct Service"}
                })
            }
            clearTimeout(timeoutId)
            if (res.status  >= 200 && res.status < 300 ) {
                const contentType = res.headers.get("content-type")
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    var restext = await res.text()
                    resolve(restext)
                } else {
                    resolve(false)
                }
            } else {
                resolve(false)
            }
        } catch(e) {
            log(e)
            resolve(false)
        }
    })
}

// fetch API token here (will use logged in session automatically)
async function createApp() {
    return new Promise(async function(resolve) {
        urlParams = new  URLSearchParams({
            client_name: "FediAct",
            redirect_uris: (browser || chrome).identity.getRedirectURL("oauth2"),
            scopes: "read write follow"
        })
        var url = "https://" + settings.fediact_homeinstance + appsApi
        try {
            var res = await fetch(url,
                {
                    method: "POST",
                    body: urlParams
                })
            var json = await res.json()
        } catch(e) {
            log(e)
            resolve(false)
            return
        }
        if (json) {
            settings.fediact_client_id = json["client_id"]
            settings.fediact_client_secret = json["client_secret"]
            resolve(true)
            return
        }
        resolve(false)
    })
}

// asks the user to log into their account and starts the oauth process
async function prepareAuth() {
    return new Promise(async function(resolve) {
        home = settings.fediact_homeinstance
        redirectUri = (browser || chrome).identity.getRedirectURL("oauth2")
        urlParams = new  URLSearchParams({
            response_type: "code",
            client_id: settings.fediact_client_id,
            redirect_uri: redirectUri,
            scope: "read write follow",
            state: btoa(JSON.stringify({
                home,
                redirectUri,
              }))
        })
        let url = `https://${settings.fediact_homeinstance}${oauthAuthorizeApi}?${urlParams.toString()}`;
        log(url);
        (browser || chrome).identity.launchWebAuthFlow({'url': url, 'interactive': true}, async function (redirectUrl) {
            if (redirectUrl) {
                log(`launchWebAuthFlow login successful: ${redirectUrl}`)
                let params = new URLSearchParams(new URL(redirectUrl).search);
                let code = params.get("code");
                await getToken(code);
                log('Background login complete')
                resolve(true)
                return
            } else {
                log("launchWebAuthFlow login failed. Is your redirect URL (" + redirectUri + ") configured with your OAuth2 provider?")
                settings.fediact_token = null
                resolve(false)
                return
            }
          })
        resolve(false)
    })
}

// gets the oauth token
async function getToken(code) {
    return new Promise(async function(resolve) {
        urlParams = new  URLSearchParams({
            grant_type: "authorization_code",
            code: code,
            client_id: settings.fediact_client_id,
            client_secret: settings.fediact_client_secret,
            redirect_uri: (browser || chrome).identity.getRedirectURL("oauth2"),
        })
        var url = `https://${settings.fediact_homeinstance}${oauthTokenApi}`;
        try {
            var res = await fetch(url,
                {
                    method: "POST",
                    body: urlParams
                })
            var json = await res.json()
        } catch(e) {
            log(e)
            resolve(false)
            return
        }
        if (json) {
            settings.fediact_token = json["access_token"]
            await (browser || chrome).storage.local.set(settings)
            resolve(true)
            return
        }
        resolve(false)
    })
}

// revokes the saved oauth token
async function revokeToken() {
    return new Promise(async function(resolve) {
        if(settings.fediact_token) {
            urlParams = new  URLSearchParams({
                client_id: settings.fediact_client_id,
                client_secret: settings.fediact_client_secret,
                token: settings.fediact_token,
            })
            var url = `https://${settings.fediact_homeinstance}${oauthRevokeApi}`;
            try {
                var res = await fetch(url,
                    {
                        method: "POST",
                        body: urlParams
                    })
                resolve(true)
            } catch(e) {
                log(e)
                resolve(false)
            }
        }
        settings.fediact_token = null
        await (browser || chrome).storage.local.set(settings)
        resolve(false)
    })
}

// removes the saved oauthApp data
async function removeOauthData() {
    return new Promise(async function(resolve) {
        settings.fediact_client_id = null
        settings.fediact_client_secret = null
        await (browser || chrome).storage.local.set(settings)
        resolve(true)
    })
}

// grab all accounts/instances that are muted/blocked by the user
// this is only done here in the bg script so we have data available on load of pages without first performing 3 (!) requests
// otherwise this would lead to problems with element detection / low performance (espcially v3 instances)
// mutes/blocks are updated in content script on page context changes and after performing mutes/block actions
function fetchMutesAndBlocks() {
    return new Promise(async function(resolve) {
        try {
            // set empty initially
            [settings.fediact_mutes, settings.fediact_blocks, settings.fediact_domainblocks] = [[],[],[]]
            var [mutes, blocks, domainblocks] = await Promise.all([
                fetch("https://" + settings.fediact_homeinstance + mutesApi, {headers: {"Authorization": "Bearer "+settings.fediact_token}}).then((response) => response.json()),
                fetch("https://" + settings.fediact_homeinstance + blocksApi, {headers: {"Authorization": "Bearer "+settings.fediact_token}}).then((response) => response.json()),
                fetch("https://" + settings.fediact_homeinstance + domainBlocksApi, {headers: {"Authorization": "Bearer "+settings.fediact_token}}).then((response) => response.json())
            ])
            if (mutes.length) {
                settings.fediact_mutes.push(...mutes.map(acc => acc.acct))
            }
            if (blocks.length) {
                settings.fediact_blocks.push(...blocks.map(acc => acc.acct))
            }
            if (domainblocks.length) {
                settings.fediact_domainblocks = domainblocks
            }
            resolve(true)
        } catch {
            fetchData(true, true, false).then(reloadListeningScripts)
            resolve(false)
        }
    })
}

async function fetchData(token, mutesblocks, resetapp) {
    return new Promise(async function(resolve) {
        var resolved = false
        try {
            settings = await (browser || chrome).storage.local.get(settingsDefaults)
            if (settings.fediact_homeinstance) {
                if (token || mutesblocks) {
                    if(resetapp) {
                        await removeOauthData()
                    }
                    if (!(settings.fediact_client_id)) {
                        await createApp()
                    }
                    if (token || !(settings.fediact_token)) {
                        await revokeToken()
                        await prepareAuth()
                    }
                    if (mutesblocks) {
                        await fetchMutesAndBlocks()
                    }
                    try {
                        await (browser || chrome).storage.local.set(settings)
                        resolved = true
                    } catch {
                        log(e)
                    }
                }
            } else {
                log("Home instance not set")
            }
        } catch(e) {
            log(e)
        }
        resolve(resolved)
    })
}

async function reloadListeningScripts() {
    chrome.tabs.query({}, async function(tabs) {
        for (var i=0; i<tabs.length; ++i) {
            try {
                chrome.tabs.sendMessage(tabs[i].id, {updatedfedisettings: true})
            } catch(e) {
                // all non-listening tabs will throw an error, we can ignore it
                continue
            }
        }
    })
}

// fetch api token right after install (mostly for debugging, when the ext. is reloaded)
chrome.runtime.onInstalled.addListener(function(){fetchData(true, true, true)})
// and also every 3 minutes
chrome.alarms.create('refresh', { periodInMinutes: tokenInterval })
chrome.alarms.onAlarm.addListener(function(){fetchData(false, true, false)})

// different listeners for inter-script communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // the content script gave us an url to perform a 302 redirect with
    if(request.externaltoot) {
        resolveExternalTootHome(request.externaltoot).then(sendResponse)
        return true
    }
    // the content script gave us an url to perform a 302 redirect with
    if(request.requestdata) {
        generalRequest(request.requestdata).then(sendResponse)
        return true
    }
    // immediately fetch api token after settings are updated
    if (request.updatedsettings) {
        fetchData(true, true, true).then(reloadListeningScripts)
        return true
    }
    if (request.updatemutedblocked) {
        fetchData(false, true, false).then(sendResponse)
        return true
    }
    // when the content script starts to process on a site, listen for tab changes (url)
    if (request.running) {
        chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
            // chrome tabs api does not support listener filters here
            // if the tabId of the update event is the same like the tabId that started the listener in the first place AND when the update event is an URL
            if (tabId === sender.tab.id && changeInfo.url) {
                // ... then let the content script know about the change
                try {
                    await chrome.tabs.sendMessage(tabId, {urlchanged: changeInfo.url})
                } catch(e) {
                    log(e)
                }
            }
        })
    }
})