# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

## Adapter-Specific Context

This is the **Places adapter** for ioBroker, which provides GPS location analysis, geofencing, and presence detection capabilities.

- **Adapter Name**: iobroker.places
- **Primary Function**: Location analysis for GPS coordinates, geofencing, presence detection
- **Key Features**:
  - GPS coordinate processing and location determination
  - Geofencing with configurable radius and multiple places
  - Integration with cloud services (iobroker.iot) for location updates
  - Presence tracking (persons at home, anybody at home)
  - Google Maps API integration for geocoding
  - Support for multiple location apps (OwnTracks, Geofency, Egigeozone)
- **Key Dependencies**:
  - `@google/maps`: Google Maps API integration for geocoding
  - `geolib`: Geospatial calculations and distance measurements
  - `request`: HTTP requests for external API calls
- **Data Processing**: GPS coordinates, location names, presence states, geofence calculations
- **External APIs**: Google Maps Geocoding API (optional), cloud service subscriptions

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Check that required states exist
                        const states = await new Promise((res, rej) => {
                            harness.states.getStates('your-adapter.0.*', (err, states) => {
                                if (err) return rej(err);
                                res(states);
                            });
                        });

                        console.log('📊 Found states:', Object.keys(states).length);
                        
                        // Check for essential states
                        const requiredStates = [
                            'your-adapter.0.info.connection'
                        ];
                        
                        for (const stateName of requiredStates) {
                            if (!states[stateName]) {
                                return reject(new Error(`Required state ${stateName} not found`));
                            }
                        }

                        console.log('✅ All required states found');
                        resolve();
                    } catch (error) {
                        console.error('❌ Integration test failed:', error);
                        reject(error);
                    }
                }).timeout(30000);
            });
        });
    },
});
```

#### Testing Pattern for Places Adapter
For the Places adapter specifically, tests should cover:

```javascript
// Test geofencing calculations
const testCoordinates = { lat: 52.520008, lon: 13.404954 }; // Berlin
const homeLocation = { lat: 52.519444, lon: 13.404167 }; // Near Berlin
const defaultRadius = 250; // meters

// Test presence detection
const testUsers = [
    { name: 'TestUser1', lat: 52.520008, lon: 13.404954 },
    { name: 'TestUser2', lat: 51.509865, lon: -0.118092 } // London - outside geofence
];

// Test Google Maps integration (if API key available)
if (process.env.GOOGLE_API_KEY) {
    // Test geocoding functionality
}

// Test cloud service integration
const mockCloudData = {
    _type: 'location',
    tid: 'testuser',
    lat: 52.520008,
    lon: 13.404954,
    tst: Date.now()
};
```

## ioBroker Adapter Patterns

### State Management
```javascript
// Always acknowledge states when setting them
await this.setStateAsync('info.connection', true, true);

// Use appropriate data types for states
await this.setStateAsync('personsAtHome', JSON.stringify(personsArray), true);
await this.setStateAsync('numberAtHome', personsArray.length, true);
await this.setStateAsync('anybodyAtHome', personsArray.length > 0, true);
```

### Configuration Handling
```javascript
// Access native configuration
const radius = this.config.radius || 250;
const googleApiKey = this.config.googleApiKey;
const places = this.config.places || [];
const users = this.config.users || [];

// Validate configuration
if (this.config.useGeocoding && !googleApiKey) {
    this.log.warn('Google API key required for geocoding but not configured');
}
```

### Location Processing Patterns
```javascript
// GPS coordinate validation
const isValidCoordinate = (lat, lon) => {
    return typeof lat === 'number' && typeof lon === 'number' &&
           lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
};

// Distance calculation using geolib
const geolib = require('geolib');
const distance = geolib.getDistance(
    { latitude: userLat, longitude: userLon },
    { latitude: placeLat, longitude: placeLon }
);

// Check if within geofence
const isAtPlace = distance <= radius;
```

### Error Handling for External APIs
```javascript
try {
    // Google Maps API call
    const response = await geocodingClient.geocode({
        params: { address: locationName, key: apiKey }
    });
    
    if (response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        return { lat: location.lat, lng: location.lng };
    }
} catch (error) {
    this.log.error(`Geocoding failed: ${error.message}`);
    return null;
}
```

### Message Handling for Location Updates
```javascript
// Handle location updates from various sources
processMessage(obj) {
    if (obj.command === 'processLocation') {
        const { user, latitude, longitude, timestamp } = obj.message;
        
        if (!isValidCoordinate(latitude, longitude)) {
            this.log.error('Invalid coordinates received');
            return;
        }
        
        this.updateUserLocation(user, latitude, longitude, timestamp);
    }
}
```

## JSON Configuration

### Admin Configuration Structure
The adapter uses the following configuration structure:

```javascript
"native": {
    "radius": 250,                    // Default geofence radius in meters
    "homeName": "Home",               // Name for the home location
    "places": [],                     // Array of configured places
    "users": [],                      // Array of tracked users
    "googleApiKey": "",               // Google Maps API key (optional)
    "useGeocoding": false,            // Enable Google Maps geocoding
    "cloudInstance": "",              // ioBroker cloud instance
    "cloudService": ""                // Cloud service selection
}
```

### Places Configuration
```javascript
const placeConfig = {
    name: "Home",
    latitude: 52.520008,
    longitude: 13.404954,
    radius: 250,                      // Individual radius override
    enabled: true
};
```

### User Configuration
```javascript
const userConfig = {
    name: "User1",
    enabled: true,
    deviceId: "device123",            // For OwnTracks integration
    lastLocation: {
        latitude: 52.520008,
        longitude: 13.404954,
        timestamp: Date.now(),
        accuracy: 10
    }
};
```

## Logging Best Practices

### Structured Logging for Location Data
```javascript
// Location update logging
this.log.debug(`Location update: ${user} at ${lat},${lon} (accuracy: ${accuracy}m)`);

// Geofence calculations
this.log.debug(`Geofence check: ${user} is ${distance}m from ${placeName} (radius: ${radius}m)`);

// Presence changes
this.log.info(`Presence changed: ${user} ${arrived ? 'arrived at' : 'left'} ${placeName}`);

// API errors
this.log.error(`Google Maps API error: ${error.message} (status: ${error.status})`);
```

## Lifecycle Management

```javascript
async onReady() {
    // Initialize connection to cloud services
    if (this.config.cloudInstance) {
        await this.subscribeStatesAsync(`${this.config.cloudInstance}.*`);
    }
    
    // Initialize places and users
    await this.initializePlaces();
    await this.initializeUsers();
    
    // Set connection state
    await this.setStateAsync('info.connection', true, true);
}

onStateChange(id, state) {
    if (state && !state.ack) {
        // Handle cloud service location updates
        if (id.includes(this.config.cloudSubscription)) {
            this.processCloudLocationUpdate(state.val);
        }
        
        // Handle clear home command
        if (id.endsWith('clearHome') && state.val) {
            this.clearHomePresence();
        }
    }
}

onMessage(obj) {
    if (obj.command === 'getLocations') {
        this.sendTo(obj.from, obj.command, this.getCurrentLocations(), obj.callback);
    }
}

onUnload(callback) {
    try {
        // Clean up timers
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        
        // Clean up connections
        // Close any open connections to external services
        
        callback();
    } catch (e) {
        callback();
    }
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```