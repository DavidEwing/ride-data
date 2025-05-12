/* Main RideData application component

Plans:
1. Fix metric/imperial toggle control to be radio buttons instead of a checkbox
2. Default to imperial units
3. Add "Reported Session Data" below the chart (sessionMesgs[0])
4. Add "Chart Data" selector to left of chart (e.g. Altitude, Speed, Heart Rate, etc.) allowing
   multiple selections of fields from recordMesgs. This should be a checkbox list of fields
   available in the FIT file recordMesgs (see below) or fetched external DEM sources (see below).
   The chart should update to show only the selected fields. Default to only showing altitude.
5. Add external DEM data sources for elevation data, controlled by a UI below the chart, allowing
   the user to trigger fetching elevation data corresponding to lat/lon from FIT file from the selected DEM source:
   a) EPQS - USGS 3DEP 1 m (USA) [https://nationalmap.gov/epqs/?x=<lon>&y=<lat>&units=Meters&output=json]
   b) OpenTopography (global LiDAR collections + 3DEP) [https://portal.opentopography.org/API/otElevation?locations=<lat>,<lon>&demtype=DEM]
   When the user clicks the button, the app should fetch the elevation data from the selected DEM source, and show progress. 
   The app should then make the elevation data available to the chart, allowing the user to select it as a chart data source.
6. Add a "Calculated Climb Data" section below the chart, showing the total ascent and descent. This should be a table with rows for each 
   altitude data set (FIT file, DEM sources) and columns for total ascent and descent. 
   The app should calculate the total ascent and descent from the altitude data assuming linear interpolation of altitude between data points.
7. Add a radio button to select between Linear and Spline interpolation for the ascent/descent data table.
   For spline interpolation, the app should recalculate the altitude data using a spline interpolation algorithm (e.g. cubic spline) for
   each row of the table, using the spline minima/maxima to calculate the total ascent and descent.

Example FIT file objects:
  recordMesgs[n]
  {
      "timestamp": "2025-05-04T14:09:45.000Z",
      "positionLat": 401449142,
      "positionLong": -1021630874,
      "gpsAccuracy": 13,
      "altitude": 296.4,
      "grade": 1.68,
      "distance": 0,
      "heartRate": 70,
      "calories": 0,
      "cadence": 54,
      "speed": 5.686,
      "power": 207,
      "batterySoc": 94,

  }

  sessionMesgs[0]
  {
      "timestamp": "2025-05-04T19:09:01.000Z",
      "startTime": "2025-05-04T14:09:44.000Z",
      "totalElapsedTime": 17957,
      "totalTimerTime": 15548,
      "avgSpeed": 4.993,
      "maxSpeed": 13.917,
      "totalDistance": 77623.97,
      "avgCadence": 70,
      "maxCadence": 117,
      "minHeartRate": 70,
      "avgHeartRate": 131,
      "maxHeartRate": 154,
      "avgPower": 224,
      "maxPower": 758,
      "totalWork": 2636877,
      "minAltitude": 267.20000000000005,
      "avgAltitude": 378,
      "maxAltitude": 477.4,
      "maxNegGrade": -9.68,
      "avgGrade": 1.06,
      "maxPosGrade": 10.84,
      "totalCalories": 2779,
      "normalizedPower": 232,
      "avgTemperature": 14,
      "maxTemperature": 23,
      "totalAscent": 1840,
      "totalDescent": 1852,
  }

*/

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Decoder, Stream } from '@garmin/fitsdk';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';
import SessionDataDisplay from './SessionDataDisplay'; // Import the new component

// Configuration for plottable fields from FIT file
const FIT_FIELDS_CONFIG = {
  altitude: { name: 'Altitude', color: '#8884d8', unitKey: 'altitudeUnit' },
  speed: { name: 'Speed', color: '#82ca9d', unitKey: 'speedUnit' },
  heartRate: { name: 'Heart Rate', unit: 'bpm', color: '#ffc658' },
  cadence: { name: 'Cadence', unit: 'rpm', color: '#ff7300' },
  power: { name: 'Power', unit: 'W', color: '#00C49F' },
  grade: { name: 'Grade', unit: '%', color: '#0088FE' },
};

// Configuration for DEM Sources
const DEM_SOURCES = {
  usgs: {
    id: 'usgs',
    name: 'USGS EPQS (USA)',
    apiUrl: 'https://epqs.nationalmap.gov/v1/', // UPDATED base URL for proxy target
    unit: 'Meters',
    attribution: 'USGS 3DEP',
    color: '#ff00ff', // Magenta
  },
  opentopo: {
    id: 'opentopo',
    name: 'OpenTopography (Global)',
    apiUrl: 'https://portal.opentopography.org/API/otElevation', // Base URL, params to be added
    unit: 'Meters',
    attribution: 'OpenTopography',
    color: '#00ffff', // Cyan
  },
};

// Helper function to convert semicircles to degrees
const semicirclesToDegrees = (semicircles) => {
  if (semicircles == null) return null;
  return semicircles * (180 / Math.pow(2, 31));
};

// Helper function for formatting timestamp in tooltip
function formatTimestampForTooltip(timestamp) {
  if (timestamp instanceof Date) {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  if (typeof timestamp === 'number') {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return 'Unknown time';
}

function App() {
  const [chartSourceData, setChartSourceData] = useState([]);
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [isMetric, setIsMetric] = useState(false);
  const [fitAvailableFields, setFitAvailableFields] = useState([]); // Renamed from availableFields
  const [selectedFields, setSelectedFields] = useState(['altitude']);

  // DEM Data State
  const [selectedDemSourceId, setSelectedDemSourceId] = useState(Object.keys(DEM_SOURCES)[0]);
  const [demDataSets, setDemDataSets] = useState({}); // E.g. { usgs: { data: [...], name: ..., color: ...}, opentopo: ... }
  const [isFetchingDem, setIsFetchingDem] = useState(false);
  const [demFetchProgress, setDemFetchProgress] = useState({ current: 0, total: 0 });
  const [demError, setDemError] = useState(null);

  const handleFetchDemElevation = useCallback(async (sourceId) => {
    if (!chartSourceData || chartSourceData.length === 0) {
      setDemError('No chart data available to fetch elevation for.');
      return;
    }

    const pointsWithCoords = chartSourceData.filter(p => p.latitude != null && p.longitude != null);
    if (pointsWithCoords.length === 0) {
      setDemError('No points with latitude/longitude found in the current FIT data.');
      return;
    }

    const demSource = DEM_SOURCES[sourceId];
    if (!demSource) {
      setDemError(`Invalid DEM source ID: ${sourceId}`);
      return;
    }

    setIsFetchingDem(true);
    setDemError(null);
    setDemFetchProgress({ current: 0, total: pointsWithCoords.length });

    const fetchedDemPoints = [];
    let successfulFetches = 0;

    if (sourceId === 'usgs') {
      for (let i = 0; i < pointsWithCoords.length; i++) {
        const point = pointsWithCoords[i];
        // Use the full apiUrl from DEM_SOURCES
        const baseUrl = demSource.apiUrl; // https://epqs.nationalmap.gov/v1/
        const apiUrl = `${baseUrl}json?x=${point.longitude}&y=${point.latitude}&units=Meters&wkid=4326&includeDate=false`;

        try {
          // Introduce a small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 50)); // 50ms delay

          const response = await fetch(apiUrl);
          if (!response.ok) {
            let errorData;
            try {
              errorData = await response.json();
            } catch (e) { /* ignore if response is not json */ }
            // New API might have different error structure, adjust if known or log generic
            const errorMessage = errorData?.message || errorData?.error || `HTTP error ${response.status}`;
            console.warn(`Failed to fetch elevation for point ${i + 1}/${pointsWithCoords.length} from ${demSource.name}: ${errorMessage}`);
          } else {
            const data = await response.json();
            // The new API response structure is simpler: { value: elevation_value }
            // Or it might be nested under a results array if multiple points were queried (not the case here per point)
            // For a single point, it's often directly data.value or similar.
            // Let's assume it's data.value based on common patterns for such APIs.
            // If the API returns an array of results even for one point: data.results[0].value
            const elevation = Number(data?.value); 

            if (!isNaN(elevation) && elevation !== -1000000) { // -1000000 is a common no-data value
              fetchedDemPoints.push({
                time: point.time, // Keep original time for mapping
                distance: point.distance, // Keep original distance for mapping
                latitude: point.latitude,
                longitude: point.longitude,
                altitude: parseFloat(elevation.toFixed(2)),
              });
              successfulFetches++;
            } else {
              console.warn(`No valid elevation data for point ${i + 1} from ${demSource.name}. Raw:`, data);
              // Check for specific error messages from the new API if available
              if (data?.messages && data.messages.length > 0) {
                console.warn(`API Messages: ${data.messages.join('; ')}`);
              }
            }
          }
        } catch (err) {
          console.warn(`Error fetching elevation for point ${i + 1} from ${demSource.name}: ${err.message}`);
        }
        setDemFetchProgress({ current: i + 1, total: pointsWithCoords.length });
      }
    } else if (sourceId === 'opentopo') {
      // OpenTopography prefers batch requests. Max ~100 points per request.
      const batchSize = 100;
      for (let i = 0; i < pointsWithCoords.length; i += batchSize) {
        const batch = pointsWithCoords.slice(i, i + batchSize);
        const locationsStr = batch.map(p => `${p.latitude},${p.longitude}`).join('|');
        const apiUrl = `${demSource.apiUrl}?locations=${locationsStr}&demtype=SRTMGL1&output=json`; 

        try {
          // Introduce a small delay between batches
          if (i > 0) await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay

          const response = await fetch(apiUrl);
          if (!response.ok) {
            console.warn(`Failed to fetch batch from ${demSource.name} (starting point ${i + 1}): HTTP error ${response.status}`);
          } else {
            const data = await response.json();
            if (data.status === 'OK' && data.results) {
              data.results.forEach((result, index_in_batch) => {
                const originalPoint = batch[index_in_batch];
                if (result.elevation != null) {
                  fetchedDemPoints.push({
                    time: originalPoint.time,
                    distance: originalPoint.distance,
                    latitude: originalPoint.latitude,
                    longitude: originalPoint.longitude,
                    altitude: parseFloat(result.elevation.toFixed(2)),
                  });
                  successfulFetches++;
                } else {
                  console.warn(`No elevation for point in OpenTopo batch: ${originalPoint.latitude},${originalPoint.longitude}. Reason: ${result.error_message || 'Unknown'}`);
                }
              });
            } else {
              console.warn(`Error from ${demSource.name} API for batch (starting point ${i + 1}): ${data.error || 'Unknown API error'}`);
            }
          }
        } catch (err) {
          console.warn(`Error fetching batch from ${demSource.name} (starting point ${i + 1}): ${err.message}`);
        }
        setDemFetchProgress({ current: Math.min(i + batchSize, pointsWithCoords.length), total: pointsWithCoords.length });
      }
    } else {
      setDemError(`DEM source ${sourceId} not implemented yet.`);
      setIsFetchingDem(false);
      return;
    }

    if (successfulFetches === 0 && pointsWithCoords.length > 0) {
        setDemError(`Could not fetch any elevation data from ${demSource.name}. Check console for details.`);
    } else if (successfulFetches < pointsWithCoords.length) {
        setDemError(`Successfully fetched ${successfulFetches} of ${pointsWithCoords.length} points from ${demSource.name}. Some points may be missing elevation. Check console.`);
    }

    setDemDataSets(prev => ({
      ...prev,
      [sourceId]: {
        data: fetchedDemPoints,
        name: demSource.name,
        color: demSource.color,
        attribution: demSource.attribution,
      }
    }));    
    setIsFetchingDem(false);
  }, [chartSourceData]);

  const onDrop = useCallback((acceptedFiles) => {
    setError(null);
    setDemError(null);
    setChartSourceData([]);
    setFileName('');
    setSessionData(null);
    setFitAvailableFields([]);
    setSelectedFields(['altitude']);
    setDemDataSets({}); // Clear previous DEM data
    setIsLoading(true);

    if (acceptedFiles.length === 0) {
      setError('No file selected or file type not accepted.');
      setIsLoading(false);
      return;
    }

    const file = acceptedFiles[0];
    setFileName(file.name);

    if (!file.name.toLowerCase().endsWith('.fit')) {
      setError('Invalid file type. Please upload a .FIT file.');
      setIsLoading(false);
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const arrayBuffer = reader.result;

      try {
        const stream = Stream.fromArrayBuffer(arrayBuffer);
        const decoder = new Decoder(stream);

        if (!decoder.isFIT()) {
          setError('File is not a valid FIT file (invalid header).');
          setIsLoading(false);
          return;
        }

        if (!decoder.checkIntegrity()) {
          setError('File integrity check failed (CRC errors). Processing halted.');
          setIsLoading(false);
          return;
        }

        const result = decoder.read({
          mesgListener: () => {},
          force: true,
          speedUnit: 'm/s',
          lengthUnit: 'm',
          temperatureUnit: 'celsius',
          elapsedRecordField: true,
          mode: 'cascade',
        });

        const messages = result.messages;

        const sessions = messages?.sessionMesgs || [];
        if (sessions.length > 0) {
          const currentSession = { ...sessions[0] };
          if (currentSession.timestamp && typeof currentSession.timestamp === 'string') {
            currentSession.timestamp = new Date(currentSession.timestamp);
          }
          if (currentSession.startTime && typeof currentSession.startTime === 'string') {
            currentSession.startTime = new Date(currentSession.startTime);
          }
          setSessionData(currentSession);
        } else {
          setSessionData(null);
        }

        const records = messages?.recordMesgs || [];
        const recordsWithDistance = records.filter(r => r.timestamp != null && (r.distance != null || r.enhancedDistance != null));

        if (recordsWithDistance.length === 0) {
          setChartSourceData([]);
          setFitAvailableFields([]);
          setSelectedFields(['altitude']);
          setError('No records with timestamp and distance found to create a chart.');
          setIsLoading(false);
          return;
        }

        const processedData = recordsWithDistance
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
          .map((record) => {
            const firstTimestamp = new Date(recordsWithDistance[0]?.timestamp ?? record.timestamp);
            const timeElapsed = (new Date(record.timestamp) - firstTimestamp);

            const dataEntry = {
              time: timeElapsed,
              distance: record.distance != null ? parseFloat((record.distance / 1000).toFixed(2)) : (record.enhancedDistance != null ? parseFloat((record.enhancedDistance / 1000).toFixed(2)) : 0),
              timestamp: new Date(record.timestamp),
              latitude: record.positionLat != null ? semicirclesToDegrees(record.positionLat) : null,
              longitude: record.positionLong != null ? semicirclesToDegrees(record.positionLong) : null,
            };

            // Add fields from FIT_FIELDS_CONFIG
            Object.keys(FIT_FIELDS_CONFIG).forEach(fieldKey => {
              if (record[fieldKey] != null) {
                if (fieldKey === 'altitude' && record.enhancedAltitude != null) {
                  dataEntry[fieldKey] = parseFloat(record.enhancedAltitude.toFixed(2));
                } else if (fieldKey === 'altitude') {
                  dataEntry[fieldKey] = parseFloat(record.altitude.toFixed(2));
                } else if (fieldKey === 'speed') { // speed from FIT is m/s
                  dataEntry[fieldKey] = parseFloat(record.speed.toFixed(3)); // m/s
                } else if (fieldKey === 'grade') {
                  dataEntry[fieldKey] = parseFloat(record.grade.toFixed(2));
                } else {
                  dataEntry[fieldKey] = record[fieldKey];
                }
              }
            });

            return dataEntry;
          });

        setChartSourceData(processedData);

        if (processedData.length > 0) {
          const firstPoint = processedData[0];
          const foundFields = Object.keys(FIT_FIELDS_CONFIG).filter(fieldKey => firstPoint[fieldKey] != null);
          setFitAvailableFields(foundFields);

          if (foundFields.includes('altitude')) {
            setSelectedFields(['altitude']);
          } else if (foundFields.length > 0) {
            setSelectedFields([foundFields[0]]);
          } else {
            setSelectedFields([]);
          }
        } else {
          setFitAvailableFields([]);
          setSelectedFields([]);
        }

      } catch (e) {
        setError(`An unexpected error occurred during decoding: ${e.message}`);
        setIsLoading(false);
      }
    };

    reader.onerror = () => {
      setError(`Failed to read the file using FileReader: ${reader.error?.message || 'Unknown error'}`);
      setIsLoading(false);
    };

    reader.readAsArrayBuffer(file);

  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/octet-stream': ['.fit'],
      'application/vnd.ant.fit': ['.fit'], // Common MIME type for FIT files
    },
    multiple: false
  });

  // Combine FIT fields and available DEM fields for selection
  const allAvailableFields = [
    ...fitAvailableFields,
    ...Object.keys(demDataSets).map(demId => `dem_${demId}_altitude`)
  ];

  const getFieldConfig = (fieldKey) => {
    if (fieldKey.startsWith('dem_')) {
      const demId = fieldKey.split('_')[1];
      const demSource = DEM_SOURCES[demId];
      if (demSource) {
        return {
          name: `${demSource.name} Altitude`,
          color: demSource.color,
          unitKey: 'altitudeUnit', // All DEMs provide altitude
        };
      }
    }
    return FIT_FIELDS_CONFIG[fieldKey];
  };

  const getDisplayData = () => {
    return chartSourceData.map(point => {
      const displayPoint = {
        ...point, // includes original time, distance, timestamp, lat, lon, and raw FIT field values
        displayDistance: isMetric 
          ? point.distance // km
          : parseFloat((point.distance * 0.621371).toFixed(2)), // miles
      };

      // Process FIT fields
      fitAvailableFields.forEach(fieldKey => {
        if (point[fieldKey] != null) {
          const config = FIT_FIELDS_CONFIG[fieldKey];
          const displayKey = `display${fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1)}`;
          if (fieldKey === 'altitude') {
            displayPoint[displayKey] = isMetric 
              ? parseFloat(point.altitude.toFixed(1)) // meters
              : parseFloat((point.altitude * 3.28084).toFixed(1)); // feet
          } else if (fieldKey === 'speed') { // speed from FIT is m/s
            displayPoint[displayKey] = isMetric 
              ? parseFloat((point.speed * 3.6).toFixed(1)) // km/h
              : parseFloat((point.speed * 2.23694).toFixed(1)); // mph
          } else if (config.unit) { // Fields with fixed units (bpm, rpm, W, %)
            displayPoint[displayKey] = point[fieldKey];
          } else { // Should not happen if config is correct
            displayPoint[displayKey] = point[fieldKey];
          }
        }
      });

      // Process DEM fields
      Object.keys(demDataSets).forEach(demId => {
        const demSet = demDataSets[demId];
        const displayKey = `displayDem${demId.charAt(0).toUpperCase() + demId.slice(1)}Altitude`;
        const demPoint = demSet.data.find(dp => dp.time === point.time || dp.distance === point.distance);
        if (demPoint && demPoint.altitude != null) {
          displayPoint[displayKey] = isMetric
            ? parseFloat(demPoint.altitude.toFixed(1)) // meters (DEMs are usually in meters)
            : parseFloat((demPoint.altitude * 3.28084).toFixed(1)); // feet
        }
      });

      return displayPoint;
    });
  };

  const displayData = getDisplayData();
  const distanceUnit = isMetric ? 'km' : 'mi';
  const altitudeUnit = isMetric ? 'm' : 'ft';

  let yAxisLabelValue = 'Value';
  if (selectedFields.length > 0) {
    const firstSelectedFieldKey = selectedFields[0];
    const config = getFieldConfig(firstSelectedFieldKey); // Use new getter
    if (config) {
      let unitSuffix = '';
      if (config.unitKey) {
        if (config.unitKey === 'altitudeUnit') unitSuffix = `(${altitudeUnit})`;
        else if (config.unitKey === 'speedUnit') unitSuffix = `(${isMetric ? 'km/h' : 'mph'})`;
      } else if (config.unit) {
        unitSuffix = `(${config.unit})`;
      }
      yAxisLabelValue = `${config.name} ${unitSuffix}`;
    }
  }

  return (
    <div className="App">
      <h1>FIT File Altitude Viewer</h1>

      <div {...getRootProps({ className: `dropzone ${isDragActive ? 'dropzone-active' : ''}` })}>
        <input {...getInputProps()} />
        {
          isDragActive ?
            <p>Drop the FIT file here ...</p> :
            <p>Drag 'n' drop a FIT file here, or click to select file</p>
        }
      </div>

      {isLoading && <p className="loading-message">Parsing file: {fileName}...</p>}
      {error && <p className="error-message">{error}</p>}
      {fileName && !isLoading && !error && chartSourceData.length > 0 && <p>Showing data for: <strong>{fileName}</strong></p>}

      {chartSourceData.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'row', marginTop: '20px' }}>
          {allAvailableFields.length > 0 && (
            <div className="chart-data-selector" style={{ width: '220px', paddingRight: '15px', marginRight: '15px', borderRight: '1px solid #eee' }}>
              <h4>Chart Data Series:</h4>
              {allAvailableFields.map(fieldKey => {
                const config = getFieldConfig(fieldKey); // Use new getter
                if (!config) return null;
                return (
                  <div key={fieldKey} style={{ marginBottom: '5px' }}>
                    <label title={`Toggle ${config.name} series`}>
                      <input
                        type="checkbox"
                        value={fieldKey}
                        checked={selectedFields.includes(fieldKey)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedFields(prev =>
                            checked ? [...prev, fieldKey] : prev.filter(sf => sf !== fieldKey)
                          );
                        }}
                        style={{ marginRight: '8px' }}
                      />
                      {config.name}
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          <div className="chart-container" style={{ flexGrow: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h2>Ride Profile</h2>
              <div className="unit-toggle">
                <label style={{ marginRight: '10px' }}>
                  <input
                    type="radio"
                    name="unit"
                    value="metric"
                    checked={isMetric}
                    onChange={() => setIsMetric(true)}
                  />
                  <span style={{ marginLeft: '5px' }}>Metric</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="unit"
                    value="imperial"
                    checked={!isMetric}
                    onChange={() => setIsMetric(false)}
                  />
                  <span style={{ marginLeft: '5px' }}>Imperial</span>
                </label>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart
                data={displayData}
                margin={{ top: 5, right: 30, left: 50, bottom: 25 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="displayDistance"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  label={{ value: `Distance (${distanceUnit})`, position: 'insideBottom', offset: -15 }}
                />
                <YAxis
                  yAxisId="left"
                  type="number"
                  label={{ 
                    value: yAxisLabelValue, 
                    angle: -90, 
                    position: 'insideLeft',
                    dx: -35,
                    style: { textAnchor: 'middle' },
                  }}
                  allowDecimals={true}
                />
                <Tooltip
                  formatter={(value, name, props) => {
                    const fieldKey = Object.keys(FIT_FIELDS_CONFIG).find(
                      fk => `display${fk.charAt(0).toUpperCase() + fk.slice(1)}` === props.dataKey
                    );

                    let displayValue = typeof value === 'number' ? value.toFixed(1) : value;

                    if (fieldKey === 'grade' && typeof value === 'number') {
                      displayValue = `${value.toFixed(1)}%`;
                    }

                    return [displayValue, FIT_FIELDS_CONFIG[fieldKey]?.name || name];
                  }}
                  labelFormatter={(label, items) => {
                    if (!items || items.length === 0) return `Distance: ${label} ${distanceUnit}`;
                    const dataPoint = items[0]?.payload;
                    const timeString = dataPoint?.timestamp ? 
                      formatTimestampForTooltip(dataPoint.timestamp) : '';
                    return `Distance: ${label} ${distanceUnit}${timeString ? ` | Time: ${timeString}` : ''}`;
                  }}
                />
                <Legend verticalAlign="top" height={36} />
                {selectedFields.map(fieldKey => {
                  const config = getFieldConfig(fieldKey); // Use new getter
                  if (!config) return null;

                  let lineName = config.name;
                  let unitForLegend = '';
                  const displayKey = fieldKey.startsWith('dem_') 
                    ? `displayDem${fieldKey.split('_')[1].charAt(0).toUpperCase() + fieldKey.split('_')[1].slice(1)}Altitude`
                    : `display${fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1)}`;

                  if (config.unitKey) {
                    if (config.unitKey === 'altitudeUnit') unitForLegend = altitudeUnit;
                    else if (config.unitKey === 'speedUnit') unitForLegend = isMetric ? 'km/h' : 'mph';
                  } else if (config.unit) {
                    unitForLegend = config.unit;
                  }
                  if (unitForLegend) {
                    lineName += ` (${unitForLegend})`;
                  }

                  return (
                    <Line
                      key={fieldKey}
                      yAxisId="left"
                      type="monotone"
                      dataKey={displayKey} // Use dynamic displayKey
                      name={lineName} 
                      stroke={config.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6 }}
                      connectNulls={true}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {chartSourceData.length === 0 && !isLoading && !error && <p>Upload a FIT file to view the ride profile.</p>}

      {/* Display Session Data */}
      {sessionData && <SessionDataDisplay sessionData={sessionData} isMetric={isMetric} />}

      {/* DEM Data Fetching UI */}
      {chartSourceData.length > 0 && (
        <div className="dem-controls" style={{ marginTop: '30px', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
          <h3>External Elevation Data (DEM)</h3>
          {chartSourceData.some(p => p.latitude != null && p.longitude != null) ? (
            <>
              <p>Fetch elevation data from an external Digital Elevation Model source. This can take some time.</p>
              <div style={{ marginBottom: '15px' }}>
                <label htmlFor="dem-source-select" style={{ marginRight: '10px' }}>Select DEM Source:</label>
                <select 
                  id="dem-source-select" 
                  value={selectedDemSourceId} 
                  onChange={(e) => setSelectedDemSourceId(e.target.value)}
                  style={{ padding: '5px' }}
                >
                  {Object.values(DEM_SOURCES).map(source => (
                    <option key={source.id} value={source.id}>{source.name}</option>
                  ))
                  }
                </select>
              </div>
              <button 
                onClick={() => handleFetchDemElevation(selectedDemSourceId)} 
                disabled={isFetchingDem || !selectedDemSourceId}
                style={{ padding: '8px 15px', cursor: 'pointer' }}
              >
                {isFetchingDem ? `Fetching (${demFetchProgress.current}/${demFetchProgress.total})...` : `Fetch ${DEM_SOURCES[selectedDemSourceId]?.name || ''} Data`}
              </button>
              {isFetchingDem && (
                <div style={{ width: '100%', backgroundColor: '#eee', borderRadius: '4px', marginTop: '10px' }}>
                  <div 
                    style={{
                      width: `${demFetchProgress.total > 0 ? (demFetchProgress.current / demFetchProgress.total) * 100 : 0}%`,
                      height: '10px',
                      backgroundColor: '#4caf50',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease-in-out'
                    }}
                  />
                </div>
              )}
              {demError && <p className="error-message" style={{ marginTop: '10px' }}>DEM Error: {demError}</p>}
              {Object.keys(demDataSets).length > 0 && (
                <div style={{marginTop: '15px'}}>
                  <h4>Fetched DEM Datasets:</h4>
                  <ul>
                    {Object.entries(demDataSets).map(([id, set]) => (
                      <li key={id}>{DEM_SOURCES[id]?.name} ({set.data?.length || 0} points) - <span style={{fontSize: '0.8em', color: 'gray'}}>Source: {DEM_SOURCES[id]?.attribution}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>No latitude/longitude data found in the FIT file records to fetch DEM data.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;