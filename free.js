var DateTime = luxon.DateTime;

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

const msalInstance = new msal.PublicClientApplication(msalConfig);

const loginRequest = {
    scopes: ['user.read']
};

let account = '';
let people = [];

msalInstance.initialize();

$(document).ready(function() {
    $('#start-time').timepicker();
    $('#end-time').timepicker();
    const params = new URLSearchParams(window.location.search);
    const ppl_string = params.get('emails');
    const city_string = params.get('city');
    const start_string = params.get('start');
    const end_string = params.get('end');
    if (ppl_string) {
        people = ppl_string.split(',');
        for (let person of people) {
            add_bubble(person);
        }
        get_bubbles();
    }
    if (city_string) {
        $('#city').val(city_string);
    }
    if (start_string) {
        $('#start-time').val(start_string);
    }
    if (end_string) {
        $('#end-time').val(end_string);
    }

    const emailInput = document.getElementById('emailInput');
    const bubbleContainer = document.getElementById('bubbleContainer');

    $("#city").autocomplete({
        source: Object.keys(zones)
    });


    emailInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            document.getElementById("get_availability").click();
        }
    });

    emailInput.addEventListener('input', () => {
        const value = emailInput.value;
        const lastChar = value.slice(-1);

        if (lastChar === ',' || lastChar === ' ' || lastChar === ';') {
            let emailParts = value.split(/[,; ]/);
            emailInput.value = '';
            for (let em of emailParts) {
                if (isValidEmail(em)) {
                    add_bubble(em);
                    get_bubbles();
                } else {
                    emailInput.value += em + ',';
                }
            }
            emailInput.value = emailInput.value.slice(0, -1);
        }
    });

    $('#loginBtn').click(function() {
        if (zones[$('#city').val()] === undefined) { 
            window.alert("Please enter a valid city.");
        } else {
            get_bubbles();
            do_the_work();            
        }
    });

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
    //emailInput.value = '';
}

function get_bubbles() {
    const bubbles = document.querySelectorAll('.bubbleText');
    people = Array.from(bubbles).map(bubble => bubble.textContent);
    var params = {
        emails: people.join(',') || '',
        start: $('#start-time').val() || '',
        end: $('#end-time').val() || '',
        city: $('#city').val() || ''
    };
    const url = $.param(params);
    $('#link').text('Permanent Link');
    $('#link').attr('href', window.location.href.split('?')[0] + '?' + url);
}

function isValidEmail(email) {
    const emailRegex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return emailRegex.test(email);
}


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
            let startBy = luxon.Duration.fromObject({
                hours: startTime.getHours(),
                minutes: startTime.getMinutes()
            });
            let endBy = luxon.Duration.fromObject({
                hours: endTime.getHours(),
                minutes: endTime.getMinutes()
            });
            let tz = zones[$('#city').val()];
            const res = find_free(response, startBy, endBy, tz);
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

function fix_event_times(event, startBy, endBy) {
    let day_start = event.start.startOf('day').plus(startBy);
    let day_end = event.start.startOf('day').plus(endBy);
    let retval = [];
    if (event.end <= day_start) return [];
    if (event.start < day_start) {
        event.start = day_start;
    }
    if (!event.start.hasSame(event.end, 'day')) {
        original_end = event.end;
        event.end = event.start.endOf('day');
        let new_event = {
            start: event.start.plus({
                days: 1
            }).startOf('day'),
            end: original_end
        };
        retval = retval.concat(fix_event_times(event, startBy, endBy));
        retval = retval.concat(fix_event_times(new_event, startBy, endBy));
    } else {
        if (event.start >= day_end) return [];
        if (event.start < day_end && event.end > day_end) {
            event.end = day_end;
        }
        retval = [event];
    }
    return retval;
}


function find_free(result, startBy, endBy, tz) {
    const SMALLEST_BLOCK = 30;
    let schedules = result.value.map(y => y.scheduleItems.filter(x => x.status !== 'free').map(x => [y.scheduleId, x.start.dateTime, x.end.dateTime]));
    let events = schedules.flatMap(calendars => calendars);
    events = events.flatMap(x => [
        [x[0], x[1], 'busy'],
        [x[0], x[2], 'free']
    ]);
    events.sort((a, b) => a[1].localeCompare(b[1]));
    let status = Object.fromEntries(people.map(p => [p, 'free']));
    let busyCount = Object.fromEntries(people.map(p => [p, 0]));;
    let freeBusyEvents = [];
    let fbFree = false;
    let event = '';
    for (let event of events) {
        busyCount[event[0]] += (event[2] === 'busy') ? 1 : -1;
        if (busyCount[event[0]] < 0) busyCount[event[0]] = 0;
        status[event[0]] = (busyCount[event[0]] === 0) ? 'free' : 'busy';
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

    let filteredEvents = freeBusyEvents.filter(event => (event.end.diff(event.start, 'minutes').minutes > (SMALLEST_BLOCK - 1)));

    // move to destination time zone
    filteredEvents = filteredEvents.map(event => ({
        start: event.start.setZone(tz),
        end: event.end.setZone(tz)
    }));
    let more_events = [];
    for (let event of filteredEvents) {
        more_events = more_events.concat(fix_event_times(event, startBy, endBy));
    }
    filteredEvents = more_events.toSorted(function(a, b) {
        return (a.start - b.start);
    });
    
    filteredEvents = filteredEvents.filter(event => (event.end.diff(event.start, 'minutes').minutes > (SMALLEST_BLOCK - 1)));
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

const zones = {
    "Abidjan": "Africa/Abidjan",
    "Abu Dhabi": "Asia/Dubai",
    "Abuja": "Africa/Lagos",
    "Acapulco": "America/Mexico_City",
    "Accra": "Africa/Accra",
    "Adak": "America/Adak",
    "Adamstown": "Pacific/Pitcairn",
    "Addis Ababa": "Africa/Addis_Ababa",
    "Adelaide": "Australia/Adelaide",
    "Aden": "Asia/Aden",
    "Agra": "Asia/Kolkata",
    "Aguascalientes": "America/Mexico_City",
    "Ahmadabad": "Asia/Kolkata",
    "Aklavik": "America/Yellowknife",
    "Akron": "America/New_York",
    "Albany": "America/New_York",
    "Albuquerque": "America/Denver",
    "Alexandria": "Africa/Cairo",
    "Algiers": "Africa/Algiers",
    "Almaty": "Asia/Almaty",
    "Alofi": "Pacific/Niue",
    "Ambon": "Asia/Jayapura",
    "Amman": "Asia/Amman",
    "Amsterdam": "Europe/Amsterdam",
    "Anadyr": "Asia/Anadyr",
    "Anaheim": "America/Los_Angeles",
    "Anchorage": "America/Anchorage",
    "Andorra La Vella": "Europe/Andorra",
    "Ankara": "Europe/Istanbul",
    "Anshan": "Asia/Shanghai",
    "Antananarivo": "Indian/Antananarivo",
    "Apia": "Pacific/Apia",
    "Aqtau": "Asia/Aqtau",
    "Aqtobe": "Asia/Aqtobe",
    "Arlington": "America/Chicago",
    "Ashgabat": "Asia/Ashgabat",
    "Asmara": "Africa/Asmara",
    "Astana": "Asia/Almaty",
    "Asuncion": "America/Asuncion",
    "Athens": "Europe/Athens",
    "Atlanta": "America/New_York",
    "Auckland": "Pacific/Auckland",
    "Augusta": "America/New_York",
    "Aurora": "America/Denver",
    "Austin": "America/Chicago",
    "Azores": "Atlantic/Azores",
    "Baghdad": "Asia/Baghdad",
    "Baku": "Asia/Baku",
    "Balikpapan": "Asia/Makassar",
    "Baltimore": "America/New_York",
    "Bamako": "Africa/Bamako",
    "Bandar Seri Begawan": "Asia/Brunei",
    "Bandung": "Asia/Jakarta",
    "Bangalore": "Asia/Kolkata",
    "Bangkok": "Asia/Bangkok",
    "Bangui": "Africa/Bangui",
    "Banjul": "Africa/Banjul",
    "Baotou": "Asia/Shanghai",
    "Barcelona": "Europe/Madrid",
    "Basra": "Asia/Baghdad",
    "Basse-Terre": "America/Guadeloupe",
    "Basseterre": "America/St_Kitts",
    "Bastia": "Europe/Paris",
    "Baton Rouge": "America/Chicago",
    "Beijing": "Asia/Shanghai",
    "Beirut": "Asia/Beirut",
    "Belfast": "Europe/London",
    "Belgrade": "Europe/Belgrade",
    "Belmopan": "America/Belize",
    "Berlin": "Europe/Berlin",
    "Bern": "Europe/Zurich",
    "Bethlehem": "Asia/Hebron",
    "Bhubaneshwar": "Asia/Kolkata",
    "Billings": "America/Denver",
    "Birmingham (UK)": "Europe/London",
    "Birmingham (USA)": "America/Chicago",
    "Bishkek": "Asia/Bishkek",
    "Bismarck": "America/Chicago",
    "Bissau": "Africa/Bissau",
    "Bogota": "America/Bogota",
    "Boise": "America/Boise",
    "Boston": "America/New_York",
    "Brasilia": "America/Sao_Paulo",
    "Bratislava": "Europe/Bratislava",
    "Brazzaville": "Africa/Brazzaville",
    "Bridgetown": "America/Barbados",
    "Brisbane": "Australia/Brisbane",
    "Brussels": "Europe/Brussels",
    "Bucharest": "Europe/Bucharest",
    "Budapest": "Europe/Budapest",
    "Buenos Aires": "America/Argentina/Buenos_Aires",
    "Buffalo": "America/New_York",
    "Bujumbura": "Africa/Bujumbura",
    "Cairo": "Africa/Cairo",
    "Calgary": "America/Edmonton",
    "Cali": "America/Bogota",
    "Canberra": "Australia/Sydney",
    "Cancun": "America/Cancun",
    "Canton": "Asia/Shanghai",
    "Cape Town": "Africa/Johannesburg",
    "Caracas": "America/Caracas",
    "Cardiff": "Europe/London",
    "Carson City": "America/Los_Angeles",
    "Casablanca": "Africa/Casablanca",
    "Castries": "America/St_Lucia",
    "Cayenne": "America/Cayenne",
    "Changchun": "Asia/Shanghai",
    "Changsha": "Asia/Shanghai",
    "Charleston": "America/New_York",
    "Charlotte": "America/New_York",
    "Charlottetown": "America/Halifax",
    "Chatham Island": "Pacific/Chatham",
    "Chelyabinsk": "Asia/Yekaterinburg",
    "Chengdu": "Asia/Shanghai",
    "Chennai": "Asia/Kolkata",
    "Cheyenne": "America/Denver",
    "Chicago": "America/Chicago",
    "Chihuahua": "America/Chihuahua",
    "Chittagong": "Asia/Dhaka",
    "Choibalsan": "Asia/Choibalsan",
    "Chongqing": "Asia/Shanghai",
    "Christchurch": "Pacific/Auckland",
    "Cincinnati": "America/New_York",
    "Cleveland": "America/New_York",
    "Colombo": "Asia/Colombo",
    "Columbia": "America/New_York",
    "Columbus": "America/New_York",
    "Conakry": "Africa/Conakry",
    "Concord": "America/New_York",
    "Copenhagen": "Europe/Copenhagen",
    "Cordoba": "Europe/Madrid",
    "Dakar": "Africa/Dakar",
    "Dalian": "Asia/Shanghai",
    "Dallas": "America/Chicago",
    "Damascus": "Asia/Damascus",
    "Dar es Salaam": "Africa/Dar_es_Salaam",
    "Darwin": "Australia/Darwin",
    "Delhi": "Asia/Kolkata",
    "Denpasar": "Asia/Makassar",
    "Denver": "America/Denver",
    "Des Moines": "America/Chicago",
    "Detroit": "America/Detroit",
    "Dhaka": "Asia/Dhaka",
    "Dili": "Asia/Dili",
    "Djibouti": "Africa/Djibouti",
    "Dodoma": "Africa/Dar_es_Salaam",
    "Doha": "Asia/Qatar",
    "Dover": "America/New_York",
    "Dubai": "Asia/Dubai",
    "Dublin": "Europe/Dublin",
    "Dushanbe": "Asia/Dushanbe",
    "Dusseldorf": "Europe/Berlin",
    "Easter Island": "Pacific/Easter",
    "Edinburgh": "Europe/London",
    "Edmonton": "America/Edmonton",
    "El Aaiun": "Africa/Casablanca",
    "El Paso": "America/Denver",
    "Ende": "Asia/Makassar",
    "Fairbanks": "America/Anchorage",
    "Faisalabad": "Asia/Karachi",
    "Fernando de Noronha": "America/Noronha",
    "Fort Worth": "America/Chicago",
    "Fort-de-France": "America/Martinique",
    "Frankfort (US)": "America/New_York",
    "Frankfurt (Ger)": "Europe/Berlin",
    "Freetown": "Africa/Freetown",
    "Fukuoka": "Asia/Tokyo",
    "Funafuti": "Pacific/Funafuti",
    "Funchal": "Atlantic/Madeira",
    "Fushun": "Asia/Shanghai",
    "Fuzhou": "Asia/Shanghai",
    "Gaborone": "Africa/Gaborone",
    "Galapagos Islands": "Pacific/Galapagos",
    "Gambier Islands": "Pacific/Gambier",
    "Gaza": "Asia/Gaza",
    "Gdansk": "Europe/Warsaw",
    "Geneva": "Europe/Zurich",
    "George Town": "America/Cayman",
    "Georgetown": "America/Guyana",
    "Gibraltar": "Europe/Gibraltar",
    "Giza": "Africa/Cairo",
    "Glasgow": "Europe/London",
    "Guadalajara": "America/Mexico_City",
    "Guam": "Pacific/Guam",
    "Guatemala": "America/Guatemala",
    "Guayaquil": "America/Guayaquil",
    "Guiyang": "Asia/Shanghai",
    "Halifax": "America/Halifax",
    "Hamburg": "Europe/Berlin",
    "Hamilton": "Atlantic/Bermuda",
    "Hangzhou": "Asia/Shanghai",
    "Hanoi": "Asia/Ho_Chi_Minh",
    "Harare": "Africa/Harare",
    "Harrisburg": "America/New_York",
    "Hartford": "America/New_York",
    "Havana": "America/Havana",
    "Helena": "America/Denver",
    "Helsinki": "Europe/Helsinki",
    "Hiroshima": "Asia/Tokyo",
    "Ho Chi Minh": "Asia/Ho_Chi_Minh",
    "Hobart": "Australia/Hobart",
    "Hong Kong": "Asia/Hong_Kong",
    "Honiara": "Pacific/Guadalcanal",
    "Honolulu": "Pacific/Honolulu",
    "Houston": "America/Chicago",
    "Hovd": "Asia/Hovd",
    "Hyderabad": "Asia/Kolkata",
    "Incheon": "Asia/Seoul",
    "Indianapolis": "America/Indiana/Indianapolis",
    "Indore": "Asia/Kolkata",
    "Iqaluit": "America/Iqaluit",
    "Irkutsk": "Asia/Irkutsk",
    "Isfahan": "Asia/Tehran",
    "Islamabad": "Asia/Karachi",
    "Istanbul": "Europe/Istanbul",
    "Izmir": "Europe/Istanbul",
    "Jackson": "America/Chicago",
    "Jacksonville": "America/New_York",
    "Jaipur": "Asia/Kolkata",
    "Jakarta": "Asia/Jakarta",
    "Jayapura": "Asia/Jayapura",
    "Jeddah": "Asia/Riyadh",
    "Jefferson City": "America/Chicago",
    "Jersey City": "America/New_York",
    "Jerusalem": "Asia/Jerusalem",
    "Jilin": "Asia/Shanghai",
    "Jinan": "Asia/Shanghai",
    "Jinzhou": "Asia/Shanghai",
    "Johannesburg": "Africa/Johannesburg",
    "Juba": "Africa/Juba",
    "Juneau": "America/Juneau",
    "Kabul": "Asia/Kabul",
    "Kaliningrad": "Europe/Kaliningrad",
    "Kampala": "Africa/Kampala",
    "Kano": "Africa/Lagos",
    "Kanpur": "Asia/Kolkata",
    "Kansas City": "America/Chicago",
    "Kaohsiung": "Asia/Taipei",
    "Karachi": "Asia/Karachi",
    "Kathmandu": "Asia/Kathmandu",
    "Kaunas": "Europe/Vilnius",
    "Kawasaki": "Asia/Tokyo",
    "Kazan": "Europe/Moscow",
    "Khartoum": "Africa/Khartoum",
    "Khon Kaen": "Asia/Bangkok",
    "Khulna": "Asia/Dhaka",
    "Kigali": "Africa/Kigali",
    "Kingston (Au)": "Pacific/Norfolk",
    "Kingston (Jm)": "America/Jamaica",
    "Kingstown": "America/St_Vincent",
    "Kinshasa": "Africa/Kinshasa",
    "Kiritimati": "Pacific/Kiritimati",
    "Kishinev": "Europe/Chisinau",
    "Kitakyushu": "Asia/Tokyo",
    "Knoxville": "America/New_York",
    "Kobe": "Asia/Tokyo",
    "Kolkata": "Asia/Kolkata",
    "Koror": "Pacific/Palau",
    "Kowloon": "Asia/Hong_Kong",
    "Krakow": "Europe/Warsaw",
    "Krasnoyarsk": "Asia/Krasnoyarsk",
    "Kuala Lumpur": "Asia/Kuala_Lumpur",
    "Kunming": "Asia/Shanghai",
    "Kupang": "Asia/Makassar",
    "Kuwait City": "Asia/Kuwait",
    "Kyiv": "Europe/Kiev",
    "Kyoto": "Asia/Tokyo",
    "La Coruna": "Europe/Madrid",
    "La Paz": "America/La_Paz",
    "La Plata": "America/Argentina/Buenos_Aires",
    "Lagos": "Africa/Lagos",
    "Lahore": "Asia/Karachi",
    "Lanzhou": "Asia/Shanghai",
    "Las Palmas": "Atlantic/Canary",
    "Las Vegas": "America/Los_Angeles",
    "Lausanne": "Europe/Zurich",
    "Leon": "America/Mexico_City",
    "Lexington-Fayette": "America/New_York",
    "Lhasa": "Asia/Shanghai",
    "Libreville": "Africa/Libreville",
    "Lilongwe": "Africa/Blantyre",
    "Lima": "America/Lima",
    "Lincoln": "America/Chicago",
    "Lisbon": "Europe/Lisbon",
    "Little Rock": "America/Chicago",
    "Liverpool": "Europe/London",
    "Ljubljana": "Europe/Ljubljana",
    "Lodz": "Europe/Warsaw",
    "Lome": "Africa/Lome",
    "London": "Europe/London",
    "Long Beach": "America/Los_Angeles",
    "Lord Howe Island": "Australia/Lord_Howe",
    "Los Angeles": "America/Los_Angeles",
    "Louisville": "America/Kentucky/Louisville",
    "Luanda": "Africa/Luanda",
    "Lubumbashi": "Africa/Lubumbashi",
    "Lucknow": "Asia/Kolkata",
    "Ludhiana": "Asia/Kolkata",
    "Luoyang": "Asia/Shanghai",
    "Lusaka": "Africa/Lusaka",
    "Luxembourg": "Europe/Luxembourg",
    "Macau": "Asia/Macau",
    "Madison": "America/Chicago",
    "Madrid": "Europe/Madrid",
    "Madurai": "Asia/Kolkata",
    "Majuro": "Pacific/Majuro",
    "Malabo": "Africa/Malabo",
    "Malang": "Asia/Jakarta",
    "Male": "Indian/Maldives",
    "Mamoudzou": "Indian/Mayotte",
    "Manado": "Asia/Makassar",
    "Managua": "America/Managua",
    "Manama": "Asia/Bahrain",
    "Manaus": "America/Manaus",
    "Manila": "Asia/Manila",
    "Maputo": "Africa/Maputo",
    "Mar del Plata": "America/Argentina/Buenos_Aires",
    "Maseru": "Africa/Maseru",
    "Mataram": "Asia/Makassar",
    "Mazatlan": "America/Mazatlan",
    "Mbabane": "Africa/Mbabane",
    "Mecca": "Asia/Riyadh",
    "Medan": "Asia/Jakarta",
    "Medellin": "America/Bogota",
    "Melbourne": "Australia/Melbourne",
    "Memphis": "America/Chicago",
    "Mendoza": "America/Argentina/Mendoza",
    "Merida": "America/Merida",
    "Mesa": "America/Phoenix",
    "Mexicali": "America/Tijuana",
    "Mexico City": "America/Mexico_City",
    "Miami": "America/New_York",
    "Milan": "Europe/Rome",
    "Milwaukee": "America/Chicago",
    "Minneapolis": "America/Chicago",
    "Minsk": "Europe/Minsk",
    "Mobile": "America/Chicago",
    "Mogadishu": "Africa/Mogadishu",
    "Monaco": "Europe/Monaco",
    "Monrovia": "Africa/Monrovia",
    "Monterrey": "America/Monterrey",
    "Montevideo": "America/Montevideo",
    "Montgomery": "America/Chicago",
    "Montpelier": "America/New_York",
    "Montreal": "America/Toronto",
    "Moroni": "Indian/Comoro",
    "Moscow": "Europe/Moscow",
    "Mumbai": "Asia/Kolkata",
    "Munich": "Europe/Berlin",
    "Murmansk": "Europe/Moscow",
    "Muscat": "Asia/Muscat",
    "Nagoya": "Asia/Tokyo",
    "Nagpur": "Asia/Kolkata",
    "Nairobi": "Africa/Nairobi",
    "Nanchang": "Asia/Shanghai",
    "Naples": "Europe/Rome",
    "Nashville": "America/Chicago",
    "Nassau": "America/Nassau",
    "Ndjamena": "Africa/Ndjamena",
    "New Delhi": "Asia/Kolkata",
    "New Orleans": "America/Chicago",
    "New York": "America/New_York",
    "Newark": "America/New_York",
    "Niamey": "Africa/Niamey",
    "Nice": "Europe/Paris",
    "Nicosia": "Asia/Nicosia",
    "Nome": "America/Nome",
    "Norfolk": "America/New_York",
    "Nouakchott": "Africa/Nouakchott",
    "Noumea": "Pacific/Noumea",
    "Novgorod": "Europe/Moscow",
    "Novosibirsk": "Asia/Novosibirsk",
    "Nukualofa": "Pacific/Tongatapu",
    "Nuuk": "America/Godthab",
    "Oakland": "America/Los_Angeles",
    "Odesa": "Europe/Kiev",
    "Okayama": "Asia/Tokyo",
    "Oklahoma City": "America/Chicago",
    "Omsk": "Asia/Omsk",
    "Oranjestad": "America/Aruba",
    "Osaka": "Asia/Tokyo",
    "Oslo": "Europe/Oslo",
    "Ottawa": "America/Toronto",
    "Ouagadougou": "Africa/Ouagadougou",
    "Pago Pago": "Pacific/Pago_Pago",
    "Palembang": "Asia/Jakarta",
    "Palma": "Europe/Madrid",
    "Panama": "America/Panama",
    "Papeete": "Pacific/Tahiti",
    "Paramaribo": "America/Paramaribo",
    "Paris": "Europe/Paris",
    "Patna": "Asia/Kolkata",
    "Pensacola": "America/Chicago",
    "Perm": "Asia/Yekaterinburg",
    "Perth": "Australia/Perth",
    "Petropavlovsk-Kamchatsky": "Asia/Kamchatka",
    "Philadelphia": "America/New_York",
    "Phnom Penh": "Asia/Phnom_Penh",
    "Phoenix": "America/Phoenix",
    "Pierre": "America/Chicago",
    "Pittsburgh": "America/New_York",
    "Plymouth": "America/Montserrat",
    "Podgorica": "Europe/Podgorica",
    "Port Louis": "Indian/Mauritius",
    "Port Moresby": "Pacific/Port_Moresby",
    "Port Vila": "Pacific/Efate",
    "Port of Spain": "America/Port_of_Spain",
    "Port-au-Prince": "America/Port-au-Prince",
    "Port-aux-Francais": "Indian/Kerguelen",
    "Portland": "America/Los_Angeles",
    "Porto Alegre": "America/Sao_Paulo",
    "Porto Novo": "Africa/Porto-Novo",
    "Porto": "Europe/Lisbon",
    "Poznan": "Europe/Warsaw",
    "Prague": "Europe/Prague",
    "Praia": "Atlantic/Cape_Verde",
    "Pretoria": "Africa/Johannesburg",
    "Pristina": "Europe/Belgrade",
    "Providence": "America/New_York",
    "Pune": "Asia/Kolkata",
    "Pusan": "Asia/Seoul",
    "Pyongyang": "Asia/Pyongyang",
    "Qiqihar": "Asia/Shanghai",
    "Quebec": "America/Toronto",
    "Quito": "America/Guayaquil",
    "Raba": "Asia/Makassar",
    "Rabat": "Africa/Casablanca",
    "Raleigh": "America/New_York",
    "Rarotonga": "Pacific/Rarotonga",
    "Rawaki": "Pacific/Enderbury",
    "Recife": "America/Recife",
    "Regina": "America/Regina",
    "Reykjavik": "Atlantic/Reykjavik",
    "Richmond": "America/New_York",
    "Riga": "Europe/Riga",
    "Rio Branco": "America/Rio_Branco",
    "Rio de Janeiro": "America/Sao_Paulo",
    "Riverside": "America/Los_Angeles",
    "Riyadh": "Asia/Riyadh",
    "Road Town": "America/Tortola",
    "Rochester": "America/New_York",
    "Rome": "Europe/Rome",
    "Rosario": "America/Argentina/Cordoba",
    "Roseau": "America/Dominica",
    "Rotterdam": "Europe/Amsterdam",
    "Sacramento": "America/Los_Angeles",
    "Saint George's": "America/Grenada",
    "Saint John (CA - NB)": "America/Moncton",
    "Saint John's (Antigua)": "America/Antigua",
    "Saint-Denis": "Indian/Reunion",
    "Saint-Peterburg (Rus)": "Europe/Moscow",
    "Saipan": "Pacific/Saipan",
    "Salem": "America/Los_Angeles",
    "Salt Lake City": "America/Denver",
    "Salta": "America/Argentina/Salta",
    "Salvador": "America/Bahia",
    "Salzburg": "Europe/Vienna",
    "Samara": "Europe/Samara",
    "San Antonio": "America/Chicago",
    "San Diego": "America/Los_Angeles",
    "San Francisco": "America/Los_Angeles",
    "San Jose (CR)": "America/Costa_Rica",
    "San Jose (USA)": "America/Los_Angeles",
    "San Juan": "America/Puerto_Rico",
    "San Luis Potosi": "America/Mexico_City",
    "San Marino": "Europe/San_Marino",
    "San Salvador": "America/El_Salvador",
    "Sana": "Asia/Aden",
    "Santa Ana": "America/El_Salvador",
    "Santa Fe": "America/Denver",
    "Santiago": "America/Santiago",
    "Santo Domingo": "America/Santo_Domingo",
    "Sao Paulo": "America/Sao_Paulo",
    "Sao Tome": "Africa/Sao_Tome",
    "Sapporo": "Asia/Tokyo",
    "Sarajevo": "Europe/Sarajevo",
    "Seattle": "America/Los_Angeles",
    "Semarang": "Asia/Jakarta",
    "Sendai": "Asia/Tokyo",
    "Seoul": "Asia/Seoul",
    "Shanghai": "Asia/Shanghai",
    "Shijiazhuang": "Asia/Shanghai",
    "Sian": "Asia/Shanghai",
    "Singapore": "Asia/Singapore",
    "Singaraja": "Asia/Makassar",
    "Sioux Falls": "America/Chicago",
    "Skopje": "Europe/Skopje",
    "Sofia": "Europe/Sofia",
    "South Tarawa": "Pacific/Tarawa",
    "St. John's (CA - NF)": "America/St_Johns",
    "St. Louis": "America/Chicago",
    "St. Paul": "America/Chicago",
    "St. Petersburg (USA-FL)": "America/New_York",
    "Stanley": "Atlantic/Stanley",
    "Stockholm": "Europe/Stockholm",
    "Stockton": "America/Los_Angeles",
    "Surabaya": "Asia/Jakarta",
    "Surakarta": "Asia/Jakarta",
    "Surat": "Asia/Kolkata",
    "Surrey": "America/Vancouver",
    "Suva": "Pacific/Fiji",
    "Sydney": "Australia/Sydney",
    "Szczecin": "Europe/Warsaw",
    "Taegu": "Asia/Seoul",
    "Taiohae": "Pacific/Marquesas",
    "Taipei": "Asia/Taipei",
    "Taiyuan": "Asia/Shanghai",
    "Tallinn": "Europe/Tallinn",
    "Tampa": "America/New_York",
    "Tanger": "Africa/Casablanca",
    "Tangshan": "Asia/Shanghai",
    "Tashkent": "Asia/Tashkent",
    "Tbilisi": "Asia/Tbilisi",
    "Tegucigalpa": "America/Tegucigalpa",
    "Tehran": "Asia/Tehran",
    "Tel Aviv": "Asia/Jerusalem",
    "Ternate": "Asia/Jayapura",
    "The Settlement": "Indian/Christmas",
    "The Valley": "America/Anguilla",
    "Thimphu": "Asia/Thimphu",
    "Tianjin": "Asia/Shanghai",
    "Tijuana": "America/Tijuana",
    "Tirana": "Europe/Tirane",
    "Tokyo": "Asia/Tokyo",
    "Toledo": "America/New_York",
    "Topeka": "America/Chicago",
    "Toronto": "America/Toronto",
    "Torshavn": "Atlantic/Faroe",
    "Trenton": "America/New_York",
    "Tripoli": "Africa/Tripoli",
    "Tsingtao": "Asia/Shanghai",
    "Tucson": "America/Phoenix",
    "Tucuman": "America/Argentina/Tucuman",
    "Tunis": "Africa/Tunis",
    "Turin": "Europe/Rome",
    "Ufa": "Asia/Yekaterinburg",
    "Ulaanbaatar": "Asia/Ulaanbaatar",
    "Unalaska": "America/Anchorage",
    "Vadodara": "Asia/Kolkata",
    "Vaduz": "Europe/Vaduz",
    "Valletta": "Europe/Malta",
    "Vancouver": "America/Vancouver",
    "Varanasi": "Asia/Kolkata",
    "Vatican City": "Europe/Vatican",
    "Venice": "Europe/Rome",
    "Veracruz": "America/Mexico_City",
    "Victoria (Canada)": "America/Vancouver",
    "Victoria (Seych.)": "Indian/Mahe",
    "Vienna": "Europe/Vienna",
    "Vientiane": "Asia/Vientiane",
    "Vilnius": "Europe/Vilnius",
    "Virginia Beach": "America/New_York",
    "Vishakhapatnam": "Asia/Kolkata",
    "Vladivostok": "Asia/Vladivostok",
    "Warsaw": "Europe/Warsaw",
    "Washington": "America/New_York",
    "Wellington": "Pacific/Auckland",
    "West Palm Beach": "America/New_York",
    "Whitehorse": "America/Whitehorse",
    "Wichita": "America/Chicago",
    "Willemstad": "America/Curacao",
    "Windhoek": "Africa/Windhoek",
    "Winnipeg": "America/Winnipeg",
    "Wroclaw": "Europe/Warsaw",
    "Wuhan": "Asia/Shanghai",
    "Yakutsk": "Asia/Yakutsk",
    "Yamoussoukro": "Africa/Abidjan",
    "Yangon": "Asia/Yangon",
    "Yaounde": "Africa/Douala",
    "Yaren": "Pacific/Nauru",
    "Yekaterinburg": "Asia/Yekaterinburg",
    "Yellowknife": "America/Yellowknife",
    "Yerevan": "Asia/Yerevan",
    "Yokohama": "Asia/Tokyo",
    "Zagreb": "Europe/Zagreb",
    "Zhengzhou": "Asia/Shanghai",
    "Zibo": "Asia/Shanghai",
    "Zurich": "Europe/Zurich"
};
