# ioBroker.places

[![NPM version](https://img.shields.io/npm/v/iobroker.places.svg)](https://www.npmjs.com/package/iobroker.places)
[![Downloads](https://img.shields.io/npm/dm/iobroker.places.svg)](https://www.npmjs.com/package/iobroker.places)
[![Dependency Status](https://img.shields.io/david/basgo/iobroker.places.svg)](https://david-dm.org/basgo/iobroker.places)


[![NPM](https://nodei.co/npm/iobroker.places.png?downloads=true)](https://nodei.co/npm/iobroker.places/)

**Tests:** Linux/Mac: [![Travis-CI](https://img.shields.io/travis/BasGo/ioBroker.places/master.svg)](https://travis-ci.org/BasGo/ioBroker.places)
Windows: [![Build status](https://ci.appveyor.com/api/projects/status/eobyt279ncmd9qbi/branch/master?svg=true)](https://ci.appveyor.com/project/BasGo/iobroker-places/branch/master)

## Description
This is an ioBroker adapter for processing location information messages which should contain a user, a geoposition and a timestamp as minimum. The adapters analyzes whether the location information is within a radius around the location configuration of ioBroker or optional other places.

## Configuration

There is just one mandatory configuration value: the radius (meters) which will be used to identify the current location of a user. The location of ioBroker is used to identify users being "at home", other places can be added as part of the configuration.

* **Radius** (_mandatory_) should be the radius in meters used to check whether the user is at a specific place (home or custom).
* **Custom Places** is a flexible list containing custom places where each place should have valid values for name, latitude and longitude.

## Usage

To process location update just send a message using the following syntax:

```javascript
// send a message to all instances of places adapter
sendTo('locations', {
        user:       "Name of person", 
        latitude:   50.9576191, 
        longitude:  6.8272409, 
        timestamp:  1520932471
});

// send a message to a specific instance of places adapter adapter
sendTo('locations.0', {
        user:       "Name of person", 
        latitude:   50.9576191, 
        longitude:  6.8272409, 
        timestamp:  1520932471
});

// send a message to a specific instance and define a callback
sendTo('locations.0', {
        user:       "Name of person", 
        latitude:   50.9576191, 
        longitude:  6.8272409, 
        timestamp:  1520932471
}, function (res) { log(JSON.stringify(res)); });

// a possible callback object 'res' will look like:
{
    "user":         "Name of person",
    "latitude":     50.9576191,
    "longitude":    6.8272409,
    "timestamp":    1520932471000,
    "date":         "2018-03-13 10:14:31",  // date extracted from timestamp
    "atHome":       false,                  // true if inside the configured radius around ioBroker
    "homeDistance": 104898,                 // distance in meters between position and ioBroker
    "name":         ""                      // name of configured place
}

```

## Changelog

### 0.2.0
* (BasGo) Materialized admin page

### 0.1.1
* (BasGo) Fixed some smaller issues

### 0.1.0
* (BasGo) Initial release

# License
This adapter is licensed under the [MIT license](../blob/master/LICENSE) which is part of this repository.

# Credits
The implementation is partly based on dschaedls [ioBroker.geofency](https://github.com/ioBroker/ioBroker.geofency) adapter. The logo has been taken from [Free Icons PNG](http://www.freeiconspng.com/images/maps-icon) and has been modified to have a transparent background.
