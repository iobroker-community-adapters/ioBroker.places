/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

var utils       = require(__dirname + '/lib/utils');
var geolib      = require('geolib');
var googleMaps  = require('@google/maps')
var adapter     = new utils.Adapter('places');

adapter.on('unload', function (callback) {
    try {
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('message', function (obj) {
    if (typeof obj !== 'object' || !obj.message || obj.command !== 'send') {
        adapter.log.warn('Ignoring invalid message!');
        return;
    }

    if (!obj.message.user || !obj.message.latitude || !obj.message.longitude || !obj.message.timestamp) {
        adapter.log.warn('Ignoring incomplete message!')
        return;
    }

    processMessage(obj.message).then(function(response){
        if (obj.callback) {
            adapter.log.debug('Found callback, returning result: ' + JSON.stringify(response));
            adapter.sendTo(obj.from, obj.command, response, obj.callback);
        }
    });
});

adapter.on('ready', function () {
    adapter.getForeignObject('system.config', null, function (err, obj) {
        if (err) {
            adapter.log.info("Adapter could not read latitude/longitude from system config!");
        } else {
            adapter.config.latitude             = obj.common.latitude;
            adapter.config.longitude            = obj.common.longitude;
            adapter.config.language             = obj.common.language;
            adapter.config.places               = adapter.config.places || [];
            adapter.config.users                = adapter.config.users || [];
            adapter.config.googleApiKey         = adapter.config.googleApiKey || '';
            adapter.config.useGeocoding         = adapter.config.useGeocoding || false;
            adapter.config.cloudSubscription    = '';
            adapter.config.cloudInstance        = adapter.config.cloudInstance || '';
            adapter.config.cloudService         = adapter.config.cloudService || '';

            if (adapter.config.cloudInstance !== '' && adapter.config.cloudService !== '') {
                adapter.config.cloudSubscription = adapter.config.cloudInstance.replace('system.adapter.', '') + ".services.custom_" + adapter.config.cloudService;
                adapter.log.debug("Subscribed to cloud: " + adapter.config.cloudSubscription);
                adapter.subscribeForeignStates(adapter.config.cloudSubscription);
            }
            adapter.subscribeStates('*');
            main();
        }
    });
});

adapter.on('stateChange', function (id, state) {
    if (id && state && !state.ack) {
        adapter.log.debug('State changed: ' + JSON.stringify(id));

        if (adapter.config.cloudSubscription.length > 0 && id.endsWith(adapter.config.cloudSubscription)) {
            adapter.log.debug("Received request from " + adapter.config.cloudSubscription + ": " + JSON.stringify(state.val));
            var r = JSON.parse(state.val);
            if (r._type && r._type == 'location' && r.tid && r.lat && r.lon && r.tst) {
                var req = { user: r.tid, latitude: r.lat, longitude: r.lon,timestamp: r.tst };
                processMessage(req).then(function(response){
                    adapter.log.debug("Processed OwnTracks request: " + JSON.stringify(response));
                });
            }
        } else {
            id = id.substring(adapter.namespace.length + 1);

            switch (id) {
                case 'clearHome':
                    adapter.setState('personsAtHome', JSON.stringify([]), false);
                    break;
                case 'personsAtHome':
                    var homePersons = state.val ? JSON.parse(state.val) : [];
                    adapter.setState('numberAtHome', homePersons.length, true);
                    adapter.setState('anybodyAtHome', homePersons.length > 0, true);
                    break;
                default:
                    break;
            }
        }
    }
});

Object.prototype.hasOwnProperty = function(property) {
    return typeof this[property] !== 'undefined';
};

String.prototype.equalIgnoreCase = function(str) {
    return (str != null &&
    typeof str === 'string' &&
    this.toUpperCase() === str.toUpperCase());
}

if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(searchString, position) {
        var subjectString = this.toString();
        if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
          position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
    };
  }

function main() {
    adapter.log.debug("Current configuration: " + JSON.stringify(adapter.config));
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
        return new Promise(function(resolve, reject) {
            resolve(req);
        })
    }

    var client = googleMaps.createClient({
        key: adapter.config.googleApiKey
    });

    return getAddress(client, req).then(r => getElevation(client, r)).then(r => getRoute(client, r));
}

function getAddress(client, req) {
    var options = {
        latlng: [req.latitude, req.longitude],
        language: adapter.config.language };

    return new Promise(function(resolve, reject) {
        client.reverseGeocode(options, function (err, response) {
            if (err) {
                adapter.log.error("Error while requesting address: " + JSON.stringify(err));
            } else {
                var obj = response.json.results[0];
                req.address = obj.hasOwnProperty('formatted_address') ? obj.formatted_address : '';
            }
            resolve(req);
        })
    })
}

function getElevation(client, req) {
    var options = {
        locations: {
            lat: req.latitude,
            lng: req.longitude }
    };

    return new Promise(function(resolve, reject) {
        client.elevation(options, function (err, response) {
            if (err) {
                adapter.log.error("Error while requesting elevation: " + JSON.stringify(err));
            } else {
                var obj = response.json.results[0];
                req.elevation = obj.hasOwnProperty('elevation') ? parseFloat(obj.elevation).toFixed(1) : '';
            }
            resolve(req);
        })
    })
}

function getRoute(client, req) {
    var options = {
        origins: req.latitude + "," + req.longitude,
        destinations: adapter.config.latitude + "," + adapter.config.longitude,
        language: adapter.config.language,
        departure_time: 'now',
        mode: 'driving',
        traffic_model: 'best_guess'
    };

    return new Promise(function(resolve, reject) {
        client.distanceMatrix(options, function (err, response) {
            if (err) {
                adapter.log.error("Error while requesting route: " + JSON.stringify(err));
            } else {
                adapter.log.debug("Received route response: " + JSON.stringify(response));
                var obj = response.json.rows[0].elements[0];
                if (obj.status == "OK") {
                    req.routeDistance               = resp.hasOwnProperty('distance') ? resp.distance.text : '';
                    req.routeDuration               = resp.hasOwnProperty('duration') ? resp.duration.text : '';
                    req.routeDurationWithTraffic    = resp.hasOwnProperty('duration_in_traffic') ? resp.duration_in_traffic.text : '';
                }
            }
            resolve(req);
        })
    })
}

function checkPlaces(req) {
    req.atHome = geolib.isPointInCircle(req, adapter.config, adapter.config.radius);
    req.distance = geolib.getDistance(req, adapter.config) || 0;
    req.name = req.name || '';

    if (req.atHome) {
        req.name = adapter.config.homeName || 'Home';
    } else {
        for (var place of adapter.config.places) {
            adapter.log.debug("Checking if position is at '" + place.name + "' (radius: " + place.radius + "m)");
            var isThere = geolib.isPointInCircle(req, place, place.radius);
            if (isThere) {
                req.name = place.name;
                adapter.log.debug("Place found, skipping other checks");
                break;
            }
        }
    }

    return new Promise(function(resolve, reject) { resolve(req); })
}

function processMessage(req) {
    req.timestamp = Number((req.timestamp + '0000000000000').substring(0, 13));
    req.date = adapter.formatDate(new Date(req.timestamp), "YYYY-MM-DD hh:mm:ss");
    adapter.log.debug('Processing location info: ' + JSON.stringify(req));
    return replaceUser(req)
            .then(r => checkPlaces(r))
            .then(r => getGeocoding(r))
            .then(r => storeLocation(r));
}

function replaceUser(req) {
    req.user = req.user || 'Dummy';

    for (var user of adapter.config.users) {
        if (req.user.equalIgnoreCase(user.name)) {
            req.user = user.replacement;
            adapter.log.debug("Replacement for user found, skipping other checks");
            break;
        }
    }

    return new Promise(function(resolve, reject) { resolve(req); })
}

function storeLocation(req) {
    // fix whitespaces in username
    var dpUser = req.user.replace(/\s|\./g, '_');

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
}

function setStates(dpUser, req) {
    return new Promise(function(resolve, reject) {
        adapter.getState(dpUser + '.timestamp', function (err, state) {
            if (err) {
                reject(err);
            } else {
                if (state && state.val) {
                    var oldTs = Number(state.val);
                    if (oldTs < req.timestamp) {
                        setValues(dpUser, req);
                    } else {
                        adapter.log.warn("Found a newer place for this user: skipping update");
                    }
                } else {
                    setValues(dpUser, req);
                }

                resolve(req);
            }
        });
    })
}

function setValues(dpUser, pos) {
    setValue(dpUser, "timestamp", pos.timestamp);
    setValue(dpUser, "date", pos.date);
    setValue(dpUser, "place", pos.name);
    setValue(dpUser, "latitude", pos.latitude);
    setValue(dpUser, "longitude", pos.longitude);
    setValue(dpUser, "distance", pos.distance);
    setValue(dpUser, "address", pos.address);
    setValue(dpUser, "elevation", pos.elevation);
    setValue(dpUser, "routeDistance", pos.routeDistance);
    setValue(dpUser, "routeDuration", pos.routeDuration);
    setValue(dpUser, "routeDurationWithTraffic", pos.routeDurationWithTraffic);

    analyzePersonsAtHome(pos);
}

function setValue(user, key, value) {
    adapter.setState(user + "." + key, { val: value, ack: true }, function (err, obj) {
        if (err) {
            adapter.log.warn("Error while setting value '" + value + "' for '" + user + "." + key + "' -> " + err);
        }
    });
}

function analyzePersonsAtHome(loc) {
    var homePersons;

    adapter.getState('personsAtHome', function (err, obj) {
        if (err) return;
        homePersons = obj ? (obj.val ? JSON.parse(obj.val) : []) : [];
        var idx = homePersons.indexOf(loc.user);

        if (idx < 0 && loc.atHome) {
            homePersons.push(loc.user);
            adapter.setState('personsAtHome', JSON.stringify(homePersons), false);
        } else if (idx >= 0 && !loc.atHome) {
            homePersons.splice(idx, 1);
            adapter.setState('personsAtHome', JSON.stringify(homePersons), false);
        }
    });
}

function checkInstanceObjects() {
    var fs = require('fs'),
        io = fs.readFileSync(__dirname + "/io-package.json"),
        objs = JSON.parse(io);

    for (var i = 0; i < objs.instanceObjects.length; i++) {
        adapter.setObjectNotExists(objs.instanceObjects[i]._id, objs.instanceObjects[i]);
    }
}