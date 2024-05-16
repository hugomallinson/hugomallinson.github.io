var DateTime = luxon.DateTime;
const emailInput = document.getElementById('emailInput');
const bubbleContainer = document.getElementById('bubbleContainer');
const msalInstance = new msal.PublicClientApplication(msalConfig);

const loginRequest = {
    scopes: ['user.read']
};

let account = '';
let people = [];

msalInstance.initialize();


emailInput.addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        document.getElementById("get_availability").click();
    }
});

emailInput.addEventListener('input', () => {
    const value = emailInput.value;
    const lastChar = value.slice(-1);

    if (lastChar === ',' || lastChar === ' ') {
        const emailPart = value.slice(0, -1).trim();
        if (isValidEmail(emailPart)) {
            add_bubble(emailPart);
            get_bubbles();
        }
    }
});

function add_bubble(emailPart) {
    const bubble = document.createElement('div');
    const bubbleText = document.createElement('span');
    bubble.className = 'bubble';
    bubbleText.className = 'bubbleText';
    bubbleText.textContent = emailPart;
    bubble.appendChild(bubbleText);
    const closeSpan = document.createElement('span');
    closeSpan.innerHTML = "&#10006;";
    closeSpan.addEventListener('click', () => {
        bubble.remove();
    });
    bubble.appendChild(closeSpan);
    bubbleContainer.appendChild(bubble);
    emailInput.value = '';
}

function get_bubbles() {
    const bubbles = document.querySelectorAll('.bubbleText');
    people = Array.from(bubbles).map(bubble => bubble.textContent);
    const url = encodeURIComponent(people.join(','));
    $('#link').text(window.location.href.split('?')[0] + '?emails=' + url);
    $('#link').attr('href', window.location.href.split('?')[0] + '?emails=' + url);
}

function isValidEmail(email) {
    const emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return emailRegex.test(email);
}

const msalConfig = {
    auth: {
        clientId: '4dc59449-ed95-4b4e-aa49-c085a30ba5c2',
        authority: 'https://login.microsoftonline.com/971f0e31-00d6-4e42-b8e0-47b342bc4455',
        redirectUri: window.location.href.split('?')[0],
    },
    cache: {
        cacheLocation: 'localStorage',
        storeAuthStateInCookie: true
    }
};

function do_the_work() {
    msalInstance.loginPopup(loginRequest)
        .then(response => {
            account = msalInstance.getAllAccounts()[0];
            let accessTokenRequest = {
                scopes: ["user.read", "calendars.read"],
                account: account,
            };
            msalInstance.acquireTokenSilent(accessTokenRequest)
                .then(tokenResponse => {
                    callGraphAPI(tokenResponse.accessToken);
                })
                .catch(error => {
                    console.error('Login error:', error);
                });
        })
        .catch(error => {
            console.error('Login error:', error);
        });
}

function callGraphAPI(accessToken) {
    const bubbles = document.querySelectorAll('.bubbleText');
    const emails = Array.from(bubbles).map(bubble => bubble.textContent);
    const start_time = DateTime.now().startOf('day');
    const end_time = start_time.plus({
        days: 60
    });
    $.ajax({
        url: 'https://graph.microsoft.com/v1.0/me/Calendar/GetSchedule',
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + accessToken
        },
        contentType: 'application/json',
        data: JSON.stringify({
            'schedules': emails,
            'startTime': {
                dateTime: start_time.toISO(),
                timeZone: 'UTC',
            },
            'endTime': {
                dateTime: end_time.toISO(),
                timeZone: 'UTC',
            },
            'outlook.timezone': 'UTC',
        }),
        dataType: "json",
        success: function(response) {
            let startTime = $('#start-time').timepicker('getTime');
            let endTime = $('#end-time').timepicker('getTime');
            let startBy = luxon.Duration.fromObject({hours: startTime.getHours(), minutes: startTime.getMinutes()});
            let endBy = luxon.Duration.fromObject({hours: endTime.getHours(), minutes: endTime.getMinutes()});
            const res = find_free(response, startBy, endBy);
            $('#availability').text(res);
        },
        error: function(error) {
            console.error('Graph API call error:', error);
        }
    });
}


// Function to check if all people are available
function isAvailable(status) {
    return Object.values(status).every(s => s === 'free');
}

function find_free(result, startBy, endBy) {
    const SMALLEST_BLOCK = 30;

    let schedules = result.value.map(y => y.scheduleItems.filter(x => x.status !== 'free').map(x => [y.scheduleId, x.start.dateTime, x.end.dateTime]));

    let events = schedules.flatMap(calendars => calendars);

    events = events.flatMap(x => [
        [x[0], x[1], 'busy'],
        [x[0], x[2], 'free']
    ]);

    events.sort((a, b) => a[1].localeCompare(b[1]));

    let status = Object.fromEntries(people.map(p => [p, 'free']));

    let freeBusyEvents = [];
    let fbFree = false;
    for (let event of events) {
        status[event[0]] = event[2];
        if (isAvailable(status) && !fbFree) {
            fbStart = DateTime.fromISO(event[1], {
                zone: "UTC"
            });
            fbFree = true;
        }
        if (!isAvailable(status) && fbFree) {
            fbEnd = DateTime.fromISO(event[1], {
                zone: "UTC"
            });
            fbFree = false;
            freeBusyEvents.push({
                start: fbStart,
                end: fbEnd
            });
        }
    }
    if (fbFree) {
        // We haven't finished the last block
        fbEnd = DateTime.fromISO(event[1], {
            zone: "UTC"
        });
        freeBusyEvents.push({
            start: fbStart,
            end: fbEnd
        });
    }

    let filteredEvents = freeBusyEvents.filter(event => (event.end.diff(event.start, 'minutes')) > (SMALLEST_BLOCK - 1));

    // move to destination time zone
    let tz = 'Europe/Paris';
    let more_events = [];
    for (let event of filteredEvents) {
        let day_start = event.start.startOf('day').plus(startBy);
        let day_end = event.start.startOf('day').plus(endBy);
        event.start = event.start.setZone(tz);
        event.end = event.end.setZone(tz);
        if (!event.start.hasSame(event.end, 'day')) {
            // assumes it's just over two days
            original_end = event.end;
            event.end = event.start.endOf('day');
            if (event.end > day_end) event.end = day_end;
            if (event.start < day_start) event.start = day_start;
            more_events.push(event);
            let new_event = {
                start: original_end.startOf('day').plus(startBy),
                end: original_end,
            };
            if (new_event.end > original_end.startOf('day').plus(endBy)) {
                new_event.end = original_end.startOf('day').plus(endBy);
            }
            more_events.push(new_event);
        } else {
            if (event.start < day_start && event.end < day_start) {
                continue;
            }
            if (event.start < day_start && event.end > day_start) {
                event.start = day_start;
            }
            if (event.end > day_end) {
                event.end = day_end;
            }
            more_events.push(event);
        }
    }
    filteredEvents = more_events.toSorted(function(a, b) {
        return (a.start - b.start);
    });

    let resultString = '';
    let lastEvent = filteredEvents[0].start.minus({
        days: 1
    });
    const start_time = DateTime.now()
    for (let event of filteredEvents) {
        if (!lastEvent.hasSame(event.start, 'day')) {
            resultString = resultString.slice(0, -1);
            resultString = resultString + '\n' + event.start.toFormat('LLL d') + ' ';
        }
        resultString = resultString + event.start.toFormat('H') + (event.start.minute > 0 ? event.start.toFormat(':mm') : '') + '-' + event.end.toFormat('H') + (event.end.minute > 0 ? event.end.toFormat(':mm') : '') + ',';
        lastEvent = event.start;
    }
    resultString = resultString.slice(0, -1);
    return resultString;
}

$(document).ready(function() {
    $('#start-time').timepicker();
    $('#end-time').timepicker();
    const params = new URLSearchParams(window.location.search);
    const ppl_string = params.get('emails')
    if (ppl_string) {
        people = ppl_string.split(',');
        for (let person of people) {
            add_bubble(person);
        }
        get_bubbles();
    }

    $('#loginBtn').click(function() {
        do_the_work();
    });

});
