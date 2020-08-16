/* jshint -W097 */
/* jshint strict:false  */
/* jshint esversion: 6  */
/* jslint node: true */
'use strict';

const utils       = require('@iobroker/adapter-core');
const geolib      = require('geolib');
const googleMaps  = require('@google/maps');
const adapterName = require('./package.json').name.split('.').pop();

let adapter;
function startAdapter(options) {
    options = options || {};
    Object.assign(options,{name:  adapterName,});

    adapter = new utils.Adapter(options);

    adapter.on('stateChange', (id, state) => {
        if (id && state && !state.ack) {
            adapter.log.debug('State changed: ' + JSON.stringify(id));
            if (adapter.config.cloudSubscription.length > 0 && id.endsWith(adapter.config.cloudSubscription) && state.val.length > 0) {
                adapter.log.debug('Received request from ' + adapter.config.cloudSubscription + ': ' + JSON.stringify(state.val));
                let r;
                try {
                    r = JSON.parse(state.val);
                } catch (e) {
                    r = {};
                }

                if (r._type && r._type === 'location' && r.tid && r.lat && r.lon && r.tst) {
                    adapter.log.debug('Request structure equals OwnTracks structure');
                    const req = { user: r.tid, latitude: r.lat, longitude: r.lon,timestamp: r.tst };
                    processMessage(req)
                        .then(response =>
                            adapter.log.debug('Processed cloud request (identifier as OwnTracks): ' + JSON.stringify(response)));
                } else {
                    processMessage(r)
                        .then(response =>
                            adapter.log.info('Processed cloud request: ' + JSON.stringify(response)));
                }
            } else {
                id = id.substring(adapter.namespace.length + 1);

                switch (id) {
                    case 'clearHome':
                        adapter.setState('personsAtHome', JSON.stringify([]), false);
                        break;

                    case 'personsAtHome':
                        let homePersons = state.val ? JSON.parse(state.val) : [];
                        try {
                            homePersons = state && state.val ? JSON.parse(state.val) : [];
                        } catch (e) {
                            homePersons = [];
                        }
                        adapter.setState('numberAtHome', homePersons.length, true);
                        adapter.setState('anybodyAtHome', !!homePersons.length, true);
                        break;

                    default:
                        break;
                }
            }
        }
    });

    adapter.on('ready', () => {
        adapter.getForeignObject('system.config', (err, obj) => {
            if (err || !obj) {
                adapter.log.info('Adapter could not read latitude/longitude from system config!');
            } else {
                if (!obj.common.longitude || !obj.common.latitude) {
                    adapter.log.info('Adapter could not read latitude/longitude from system config! Fields are empty');
                }

                adapter.config.latitude             = parseFloat(obj.common.latitude);
                adapter.config.longitude            = parseFloat(obj.common.longitude);
                adapter.config.language             = obj.common.language;
            }

            adapter.config.places               = adapter.config.places || [];
            adapter.config.users                = adapter.config.users  || [];
            adapter.config.googleApiKey         = adapter.config.googleApiKey || '';
            adapter.config.useGeocoding         = adapter.config.useGeocoding || false;
            adapter.config.cloudSubscription    = '';
            adapter.config.cloudInstance        = adapter.config.cloudInstance || '';
            adapter.config.cloudService         = adapter.config.cloudService  || '';

            adapter.config.places.forEach(place => {
                place.latitude  = parseFloat(place.latitude);
                place.longitude = parseFloat(place.longitude);
                place.radius    = parseFloat(place.radius);
            });

            if (adapter.config.cloudInstance && adapter.config.cloudService) {
                adapter.config.cloudSubscription = adapter.config.cloudInstance.replace('system.adapter.', '') + '.services.custom_' + adapter.config.cloudService;
                adapter.log.debug('Subscribed to cloud service: ' + adapter.config.cloudSubscription);
                adapter.subscribeForeignStates(adapter.config.cloudSubscription);
            }
            adapter.subscribeStates('*');
            main();
        });
    });

    adapter.on('message', obj => {
        if (typeof obj !== 'object' || !obj.message || obj.command !== 'send') {
            adapter.log.warn('Ignoring invalid message!');
            return false;
        }
    
        if (!obj.message.user || !obj.message.latitude || !obj.message.longitude || !obj.message.timestamp) {
            adapter.log.warn('Ignoring incomplete message!');
            return false;
        }
    
        processMessage(obj.message)
            .then(response => {
                if (obj.callback) {
                    adapter.log.info('Processed message, returning result: ' + JSON.stringify(response));
                    adapter.sendTo(obj.from, obj.command, response, obj.callback);
                }
            });

        return true;
    });

    return adapter;
}

String.prototype.equalIgnoreCase = function (str) {
    return str != null &&
        typeof str === 'string' &&
        this.toUpperCase() === str.toUpperCase();
};

if (!String.prototype.endsWith) {
    String.prototype.endsWith = function (searchString, position) {
        const subjectString = this.toString();
        if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
          position = subjectString.length;
        }
        position -= searchString.length;
        const lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    };
  }

function main() {
    adapter.log.debug('Current configuration: ' + JSON.stringify(adapter.config));
    checkInstanceObjects();
}

function getGeocoding(req) {
    req.address = '';
    req.elevation = 0;
    req.routeDistance = '';
    req.routeDuration = '';
    req.routeDurationWithTraffic = '';

    if (!adapter.config.useGeocoding || !adapter.config.googleApiKey || adapter.config.googleApiKey.length < 10) {
        adapter.log.debug('Skipping geocoding (either deactivated by configuration or invalid API key)');
        return Promise.resolve(req);
    }

    const client = googleMaps.createClient({
        key: adapter.config.googleApiKey
    });

    return getAddress(client, req)
        .then(r => getElevation(client, r))
        .then(r => getRoute(client, r));
}

function getAddress(client, req) {
    const options = {
        latlng: [req.latitude, req.longitude],
        language: adapter.config.language };

    return new Promise(resolve =>
        client.reverseGeocode(options, (err, response) => {
            if (err) {
                adapter.log.error('Error while requesting address: ' + JSON.stringify(err));
            } else {
                adapter.log.debug('Received geocode response: ' + JSON.stringify(response));
                const obj = response.json.results[0];
                req.address = obj.hasOwnProperty('formatted_address') ? obj.formatted_address : '';
                adapter.log.debug('Retrieved address -> address: ' + req.address);
            }

            resolve(req);
        }));
}

function getElevation(client, req) {
    const options = {
        locations: {
            lat: req.latitude,
            lng: req.longitude }
    };

    return new Promise(resolve =>
        client.elevation(options, (err, response) => {
            if (err) {
                adapter.log.error('Error while requesting elevation: ' + JSON.stringify(err));
            } else {
                adapter.log.debug('Received elevation response: ' + JSON.stringify(response));
                const obj = response.json.results[0];
                req.elevation = obj.hasOwnProperty('elevation') ? Math.round(parseFloat(obj.elevation) * 10) / 10  : -1;
                adapter.log.debug('Retrieved elevation -> elevation: ' + req.elevation);
            }

            resolve(req);
        }));
}

function getRoute(client, req) {
    const options = {
        origins:       req.latitude + ',' + req.longitude,
        destinations:  adapter.config.latitude + ',' + adapter.config.longitude,
        language:      adapter.config.language,
        departure_time: 'now',
        mode:           'driving',
        traffic_model:  'best_guess'
    };

    return new Promise(resolve =>
        client.distanceMatrix(options, (err, response) => {
            if (err) {
                adapter.log.error('Error while requesting route: ' + JSON.stringify(err));
            } else {
                adapter.log.debug('Received route response: ' + JSON.stringify(response));
                const obj = response.json.rows[0].elements[0];
                if (obj.status === 'OK') {
                    req.routeDistance               = obj.hasOwnProperty('distance') ? obj.distance.text : '';
                    req.routeDuration               = obj.hasOwnProperty('duration') ? obj.duration.text : '';
                    req.routeDurationWithTraffic    = obj.hasOwnProperty('duration_in_traffic') ? obj.duration_in_traffic.text : '';
                    adapter.log.debug('Retrieved routing details -> routeDistance: ' + req.routeDistance + ', routeDuration: ' + req.routeDuration + ', routeDurationWithTraffix: ' + req.routeDurationWithTraffic);
                }
            }

            resolve(req);
        }));
}

function checkPlaces(req) {
    req.atHome = geolib.isPointWithinRadius(req, adapter.config, adapter.config.radius);
    req.distance = geolib.getPreciseDistance(req, adapter.config) || 0;
    req.name = req.name || '';

    if (req.atHome) {
        req.name = adapter.config.homeName || 'Home';
    } else {
        for (const place of adapter.config.places) {
            adapter.log.debug('Checking if position is at "' + place.name + '" (radius: ' + place.radius + 'm)');
            const isThere = geolib.isPointWithinRadius(req, place, place.radius);
            if (isThere) {
                req.name = place.name;
                adapter.log.debug('Place found, skipping other checks');
                break;
            }
        }
    }

    return Promise.resolve(req);
}

function processMessage(req) {
    req.timestamp = Number((req.timestamp + '0000000000000').substring(0, 13));
    req.date = adapter.formatDate(new Date(req.timestamp), 'YYYY-MM-DD hh:mm:ss');
    adapter.log.debug('Processing message: ' + JSON.stringify(req));

    return replaceUser(req)
            .then(r => checkPlaces(r))
            .then(r => getGeocoding(r))
            .then(r => storeLocation(r));
}

function replaceUser(req) {
    req.user = req.user || 'Dummy';

    for (const user of adapter.config.users) {
        adapter.log.debug('Checking if user "' + req.user + '" should be replaced with "' + user.name + '"');
        if (user.replacement && req.user.equalIgnoreCase(user.name)) {
            req.user = user.replacement;
            adapter.log.debug('Replacement for user found, skipping other checks');
            break;
        }
    }

    return Promise.resolve(req);
}

function storeLocation(req) {
    // fix whitespaces in username
    const dpUser = req.user.replace(/\s|\./g, '_');

    if (dpUser) {
        // create object for user
        adapter.setObjectNotExists(dpUser, { type: 'device', common: { id: dpUser, name: dpUser }, native: { name: dpUser, device: dpUser } });

        // create objects for states
        adapter.setObjectNotExists(dpUser + '.place', { type: 'state', common: { role: 'text', name: 'place', read: true, write: false, type: 'string' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.timestamp', { type: 'state', common: { role: 'value', name: 'timestamp', read: true, write: false, type: 'number' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.distance', { type: 'state', common: { role: 'value', name: 'distance', read: true, write: false, type: 'number' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.latitude', { type: 'state', common: { role: 'value.gps.latitude', name: 'latitude', read: true, write: false, type: 'number' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.longitude', { type: 'state', common: { role: 'value.gps.longitude', name: 'longitude', read: true, write: false, type: 'number' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.date', { type: 'state', common: { role: 'text', name: 'date', read: true, write: false, type: 'string' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.elevation', { type: 'state', common: { role: 'value', name: 'elevation', read: true, write: false, type: 'number' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.address', { type: 'state', common: { role: 'text', name: 'address', read: true, write: false, type: 'string' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.routeDistance', { type: 'state', common: { role: 'text', name: 'routeDistance', read: true, write: false, type: 'string' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.routeDuration', { type: 'state', common: { role: 'text', name: 'routeDuration', read: true, write: false, type: 'string' }, native: {} });
        adapter.setObjectNotExists(dpUser + '.routeDurationWithTraffic', { type: 'state', common: { role: 'text', name: 'routeDurationWithTraffic', read: true, write: false, type: 'string' }, native: {} });

        return setStates(dpUser, req);
    } else {
        return Promise.reject('No user name provided')
    }
}

function setStates(dpUser, req) {
    return new Promise((resolve, reject) => {
        adapter.getState(dpUser + '.timestamp', (err, state) => {
            if (err) {
                reject(err);
            } else {
                if (state && state.val) {
                    const oldTs = Number(state.val);
                    if (oldTs < req.timestamp) {
                        setValues(dpUser, req);
                    } else {
                        adapter.log.warn('Found a newer place for this user: skipping update');
                    }
                } else {
                    setValues(dpUser, req);
                }

                resolve(req);
            }
        });
    });
}

function setValues(dpUser, pos) {
    adapter.log.debug('Setting values for user ' + dpUser);
    setValue(dpUser, 'timestamp', pos.timestamp);
    setValue(dpUser, 'date', pos.date);
    setValue(dpUser, 'place', pos.name);
    setValue(dpUser, 'latitude', pos.latitude);
    setValue(dpUser, 'longitude', pos.longitude);
    setValue(dpUser, 'distance', pos.distance);
    setValue(dpUser, 'address', pos.address);
    setValue(dpUser, 'elevation', pos.elevation);
    setValue(dpUser, 'routeDistance', pos.routeDistance);
    setValue(dpUser, 'routeDuration', pos.routeDuration);
    setValue(dpUser, 'routeDurationWithTraffic', pos.routeDurationWithTraffic);

    analyzePersonsAtHome(pos);
}

function setValue(user, key, value) {
    adapter.setState(user + '.' + key, { val: value, ack: true }, err =>
        err && adapter.log.warn('Error while setting value "' + value + '" for "' + user + '.' + key + '" -> ' + err));
}

function analyzePersonsAtHome(loc) {
    let homePersons;

    adapter.log.debug('Updating persons at home');

    adapter.getState('personsAtHome', (err, state) => {
        if (err) {
            return;
        }
        try {
            homePersons = state && state.val ? JSON.parse(state.val) : [];
        } catch (e) {
            homePersons = [];
        }
        const idx = homePersons.indexOf(loc.user);

        if (idx < 0 && loc.atHome) {
            homePersons.push(loc.user);
            adapter.setState('personsAtHome', JSON.stringify(homePersons), false);
            adapter.log.debug('Added person at home');
        } else if (idx >= 0 && !loc.atHome) {
            homePersons.splice(idx, 1);
            adapter.setState('personsAtHome', JSON.stringify(homePersons), false);
            adapter.log.debug('Removed person from home');
        }
    });
}

function checkInstanceObjects() {
    const objs = require('./io-package.json');

    for (let i = 0; i < objs.instanceObjects.length; i++) {
        adapter.setObjectNotExists(objs.instanceObjects[i]._id, objs.instanceObjects[i]);
    }
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
} 