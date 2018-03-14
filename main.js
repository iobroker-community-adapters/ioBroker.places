/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

var utils =    require(__dirname + '/lib/utils'); 
var geolib = require('geolib');

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter = new utils.Adapter('places');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info("Adapter got 'unload' signal -> cleaning up ...");
        callback();
    } catch (e) {
        callback();
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj !== 'object' || !obj.message || obj.command !== 'send') {
        adapter.log.warn('Ignoring invalid message!');
        return;
    }

    if (!obj.message.user || !obj.message.latitude || !obj.message.longitude || !obj.message.timestamp) {
        adapter.log.warn('Ignoring incomplete message!')
        return;
    }

    // ensure having correct timestamp
    obj.message.timestamp = Number((obj.message.timestamp + '0000000000000').substring(0, 13));
    adapter.log.debug('Received message with location info -> ' + JSON.stringify(obj.message));

    // process message
    var response = processMessage(obj.message);

    // send response in callback if required, response will be the enriched location
    if (obj.callback) adapter.sendTo(obj.from, obj.command, response, obj.callback);
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    adapter.getForeignObject('system.config', null, function (err, obj) {
        if (err) {
            adapter.log.info("Adapter could not read latitude/longitude from system config!");
        } else {
            adapter.config.latitude = obj.common.latitude;
            adapter.config.longitude = obj.common.longitude;
            adapter.log.info("Adapter got 'ready' signal -> calling main function ...");
            main();
        }
    });
});

function main() {
    adapter.log.debug("Current configuration -> " + JSON.stringify(adapter.config));
}

function processMessage(msg) {
    msg.user = msg.user || 'Dummy';

    msg.date = adapter.formatDate(new Date(msg.timestamp), "YYYY-MM-DD hh:mm:ss");
    msg.atHome = geolib.isPointInCircle(msg, adapter.config, adapter.config.radius);
    msg.homeDistance = geolib.getDistance(msg, adapter.config) || 0;

    if (msg.atHome) {
        msg.name = "zuhause";
    } else {
        adapter.config.places.forEach(function(place) {
            var isThere = geolib.isPointInCircle(msg, place, adapter.config.radius);
            if (isThere) {
                msg.name = place.name;
            }
        });
    }

    msg.name = msg.name || '';

    adapter.log.debug('New location  -> ' + JSON.stringify(msg));

    // fix whitespaces in username
    var dpUser = msg.user.replace(/\s|\./g, '_');
    // create user device (if not exists)
    adapter.getObject(dpUser, function (err, obj) {
        if (err || !obj) {
            adapter.log.debug("Creating device for user '" + msg.user + "'");
            adapter.setObjectNotExists(dpUser, {
                type: 'device',
                common: {id: dpUser, name: dpUser},
                native: {name: dpUser, device: dpUser}
            });

            // create states
            adapter.setObjectNotExists(dpUser + '.place', {type: 'state', common: {role: 'text', name: 'place', read: true, write: false, type: 'string'}, native: {}});
            adapter.setObjectNotExists(dpUser + '.timestamp', {type: 'state', common: {role: 'value', name: 'timestamp', read: true, write: false, type: 'number'}, native: {}});
            adapter.setObjectNotExists(dpUser + '.distance', {type: 'state', common: {role: 'value', name: 'distance', read: true, write: false, type: 'number'}, native: {}});
            adapter.setObjectNotExists(dpUser + '.latitude', {type: 'state', common: {role: 'value.gps.latitude', name: 'latitude', read: true, write: false, type: 'number'}, native: {}});
            adapter.setObjectNotExists(dpUser + '.longitude', {type: 'state', common: {role: 'value.gps.longitude', name: 'longitude', read: true, write: false, type: 'number'}, native: {}});
            adapter.setObjectNotExists(dpUser + '.date', {type: 'state', common: {role: 'text', name: 'date', read: true, write: false, type: 'string'}, native: {}});

            setStateValues(dpUser, msg);
        } else if (!err && obj) {
            setStateValues(dpUser, msg);
        }
    });

    return msg;
}

function setStateValues(dpUser, loc) {
    setStateValue(dpUser, "timestamp", loc.timestamp);
    setStateValue(dpUser, "date", loc.date);
    setStateValue(dpUser, "place", loc.name);
    setStateValue(dpUser, "latitude", loc.latitude);
    setStateValue(dpUser, "longitude", loc.longitude);
    setStateValue(dpUser, "distance", loc.homeDistance);

    analyzePersonsAtHome(loc);
}

function setStateValue(user, key, value) {
    adapter.setState(user + "." + key, {val: value, ack: true}, function (err, obj) {
        if (err) {
            adapter.log.warn("Error while setting value '" + value + "' for '" + user + "." + key+"' -> " + err);
        } else if (obj) {
            adapter.log.silly("Successfully set value '" + value + "' for '" + user + "." + key+"' -> " + obj);
        }
    });
}

function analyzePersonsAtHome(loc) {
    var homeCount, homePersons;
    adapter.getState('numberAtHome', function (err, obj) {
        if (err) return;
        homeCount = obj ? obj.val : 0;
        adapter.getState('personsAtHome', function (err, obj) {
            if (err) return;
            homePersons = obj ? (obj.val ? JSON.parse(obj.val) : []) : [];
            var idx = homePersons.indexOf(loc.user);

            if (idx < 0 && loc.atHome) {
                homePersons.push(loc.user);
                adapter.setState('personsAtHome', JSON.stringify(homePersons), true);
            } else if (idx >= 0 && !loc.atHome) {
                homePersons.splice(idx, 1);
                adapter.setState('personsAtHome', JSON.stringify(homePersons), true);
            }

            if (homeCount !== homePersons.length) adapter.setState('numberAtHome', homePersons.length, true);
        });
    });
}
