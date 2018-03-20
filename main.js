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

    processMessage(obj.message, function(response){
        if (obj.callback) {
            adapter.log.silly('Found callback, returning result: ' + JSON.stringify(response));
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
            var req = JSON.parse(state.val);
            if (req._type && req._type == 'location' && req.tid && req.lat && req.lon && req.tst) {
                var loc = { user: req.tid, latitude: req.lat, longitude: req.lon,timestamp: req.tst };
                processMessage(loc, function(response){
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

function getGeolocation(loc, cb) {
    loc.address = '';
    loc.elevation = 0;

    if (!adapter.config.useGeocoding) {
        adapter.log.debug('Skipping geocoding (deactivated by configuration)');
        cb(loc);
        return;
    }

    if (!adapter.config.googleApiKey || adapter.config.googleApiKey.length < 10) {
        adapter.log.debug('Skipping geocoding (invalid API key)');
        cb(loc);
        return;
    }

    var client = googleMaps.createClient({
        key: adapter.config.googleApiKey
    });

    client.reverseGeocode({
        latlng: [loc.latitude, loc.longitude],
        language: 'de'
    }, function (err, response) {
        if (err) {
            adapter.log.error('Error while getting reverse geocode: ' + err);
        } else if (response) {
            loc.address = response.json.results[0].formatted_address
        }

        client.elevation({
            locations: { lat: loc.latitude, lng: loc.longitude }
        }, function (err, response) {
            if (err) {
                adapter.log.error('Error while getting elevation: ' + err);
            } else if (response) {
                loc.elevation = parseFloat(response.json.results[0].elevation).toFixed(1);
            }

            adapter.log.debug('Finished geocoding: ' + JSON.stringify(loc));
            cb(loc);
        });
    });
}

function processMessage(msg, cb) {
    msg.user = msg.user || 'Dummy';
    msg.timestamp = Number((msg.timestamp + '0000000000000').substring(0, 13));
    msg.date = adapter.formatDate(new Date(msg.timestamp), "YYYY-MM-DD hh:mm:ss");
    adapter.log.debug('Processing location info: ' + JSON.stringify(obj.message));

    msg.atHome = geolib.isPointInCircle(msg, adapter.config, adapter.config.radius);
    msg.homeDistance = geolib.getDistance(msg, adapter.config) || 0;

    if (msg.atHome) {
        msg.name = adapter.config.homeName || 'Home';
    } else {
        for (var place of adapter.config.places) {
            adapter.log.silly("Checking if position is at '" + place.name + "' (radius: " + place.radius + "m)");
            var isThere = geolib.isPointInCircle(msg, place, place.radius);
            if (isThere) {
                msg.name = place.name;
                adapter.log.debug("Place found, skipping other checks");
                break;
            }
        }
    }

    getGeolocation(msg, function(result) {
        // try if user should be replaced
        for (var user of adapter.config.users) {
            if (result.user.equalIgnoreCase(user.name)) {
                result.user = user.replacement;
                adapter.log.silly("Replacement for user found, skipping other checks");
                break;
            }
        }

        // some default values if no valid content
        result.user = result.user || 'Dummy';
        result.name = result.name || '';

        adapter.log.debug('Finished place analysis: ' + JSON.stringify(result));

        // fix whitespaces in username
        var dpUser = result.user.replace(/\s|\./g, '_');

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
    
        // set states
        setStates(dpUser, result, function() {
            cb(result);
        });


    });
}

function setStates(dpUser, loc, cb) {
    adapter.getState(dpUser + '.timestamp', function (err, state) {
        if (!err && state && state.val) {
            var oldTs = Number(state.val);
            if (oldTs < loc.timestamp) {
                setValues(dpUser, loc);
            } else {
                adapter.log.warn("Found a newer place for this user: skipping update");
            }
        } else {
            setValues(dpUser, loc);
        }

        cb();
    });
}

function setValues(dpUser, pos) {
    setValue(dpUser, "timestamp", pos.timestamp);
    setValue(dpUser, "date", pos.date);
    setValue(dpUser, "place", pos.name);
    setValue(dpUser, "latitude", pos.latitude);
    setValue(dpUser, "longitude", pos.longitude);
    setValue(dpUser, "distance", pos.homeDistance);
    setValue(dpUser, "address", pos.address);
    setValue(dpUser, "elevation", pos.elevation);

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