// src/App.js
import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
// Correct import: Use Decoder and Stream
import { Decoder, Stream } from '@garmin/fitsdk';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

// Helper function for formatting timestamp in tooltip
function formatTimestampForTooltip(timestamp) {
  // Check if timestamp is already a Date object
  if (timestamp instanceof Date) {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  // If it's a number, assume it needs conversion
  if (typeof timestamp === 'number') {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  // Fallback
  return 'Unknown time';
}

function App() {
  const [altitudeData, setAltitudeData] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [isMetric, setIsMetric] = useState(true);

  const onDrop = useCallback((acceptedFiles) => {
    setError(null);
    setAltitudeData([]);
    setFileName('');
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
        console.log("Stream created successfully."); // Log success

        const decoder = new Decoder(stream);
        console.log("Decoder created.");

        if (!decoder.isFIT()) {
          console.error("decoder.isFIT() returned false.");
          setError('File is not a valid FIT file (invalid header).');
          setIsLoading(false);
          return;
        }
        console.log("decoder.isFIT() returned true.");

        if (!decoder.checkIntegrity()) {
          console.warn("FIT File Integrity Check Failed");
          setError('File integrity check failed (CRC errors). Processing halted.');
          setIsLoading(false);
          return;
        } else {
          console.log("File integrity check passed.");
        }

        let messageCount = 0;
        const startTime = performance.now();

        const result = decoder.read({
          // Options object:
          mesgListener: (messageNum, message) => {
            messageCount++;
            if (messageCount % 1000 === 0) {
              const elapsed = (performance.now() - startTime) / 1000;
              console.log(`mesgListener: Decoded ${messageCount} messages... Elapsed: ${elapsed.toFixed(2)}s`);
            }
          },
          force: true,
          speedUnit: 'm/s',
          lengthUnit: 'm',
          temperatureUnit: 'celsius',
          elapsedRecordField: true,
          mode: 'cascade',
          // Add other options from the signature if needed, e.g.:
          // expandSubFields: true,
          // expandComponents: true,
          // applyScaleAndOffset: true,
          // convertTypesToStrings: true,
          // convertDateTimesToDates: true,
          // includeUnknownData: true,
          // mergeHeartRates: true,
          // decodeMemoGlobs: true,
        }); // End of options object, NO second argument callback

        // Processing finished (or failed internally), log completion time
        const totalTime = (performance.now() - startTime) / 1000;
        console.log(`decoder.read() finished. Total messages found by listener: ${messageCount}. Total time: ${totalTime.toFixed(2)}s`);
        setIsLoading(false); // Stop loading indicator here

        // Check for errors returned by the method
        if (result.errors && result.errors.length > 0) {
          console.error("FIT Read Errors returned:", result.errors);
          // Display the first error, or combine them
          setError(`Error reading FIT messages: ${result.errors[0].message || result.errors[0]}`);
          return; // Stop processing
        }

        // Access the messages from the return value
        const messages = result.messages;
        console.log("Parsed FIT Messages object:", messages);

        // --- Resume processing the 'messages' object as before ---
        const records = messages?.recordMesgs || [];
        console.log(`Found ${records.length} record messages in final object.`);

        if (records.length === 0) {
          // ... (error handling for no records) ...
          console.log("No records found in final object. Checking sessions...");
          const sessions = messages?.sessions || [];
          if (sessions.length > 0) {
            setError('File contains session data but no detailed record data for altitude profile.');
          } else {
            setError('No record messages found in the FIT file to create an altitude profile.');
          }
          return;
        }

        // Process records...
        console.log("Processing records for altitude data...");
        const processedData = records
          .filter(record => (record.altitude != null || record.enhanced_altitude != null) && record.timestamp != null)
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((record, index, arr) => {
            const altitude = record.enhancedAltitude ?? record.altitude;
            // Extract distance data (may be stored as enhancedDistance or distance)
            const distance = record.enhancedDistance ?? record.distance ?? 0;
            const firstTimestamp = arr[0]?.timestamp ?? record.timestamp;
            const timeElapsed = record.timestamp - firstTimestamp;
            return {
              time: timeElapsed,
              // Convert distance to kilometers for better readability
              distance: distance ? parseFloat((distance / 1000).toFixed(2)) : 0,
              altitude: parseFloat(altitude.toFixed(2)),
              timestamp: record.timestamp, // Store the original timestamp
            };
          });

        console.log(`Processed ${processedData.length} data points for chart.`);
        if (processedData.length === 0) {
          setError('No records with both timestamp and altitude found after processing.');
          return;
        }

        setAltitudeData(processedData);
        // --- End of processing ---

      } catch (e) {
        // Catch errors during Stream/Decoder setup or synchronous parts of .read()
        console.error("Error during FIT decoding setup/process:", e);
        setError(`An unexpected error occurred during decoding: ${e.message}`);
        setIsLoading(false);
      }

  }; // End of reader.onload

  reader.onerror = () => {
    console.error("FileReader onerror event triggered.", reader.error);
    setError(`Failed to read the file using FileReader: ${reader.error?.message || 'Unknown error'}`);
    setIsLoading(false);
  };

  // Make sure this is the last thing before the end of onDrop
  console.log(`Calling reader.readAsArrayBuffer for file: ${file.name}`);
  reader.readAsArrayBuffer(file);

}, []); // End of useCallback

const { getRootProps, getInputProps, isDragActive } = useDropzone({
  onDrop,
  accept: {
    'application/octet-stream': ['.fit'],
    'application/vnd.ant.fit': ['.fit'],
  },
  multiple: false
});

// Convert units for display based on current unit setting
const getDisplayData = () => {
  return altitudeData.map(point => ({
    ...point,
    displayDistance: isMetric 
      ? point.distance 
      : parseFloat((point.distance * 0.621371).toFixed(2)), // km to miles
    displayAltitude: isMetric 
      ? point.altitude 
      : parseFloat((point.altitude * 3.28084).toFixed(2))   // meters to feet
  }));
};

const displayData = getDisplayData();
const distanceUnit = isMetric ? 'km' : 'mi';
const altitudeUnit = isMetric ? 'm' : 'ft';

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
    {error && <p className="error-message">{error}</p>} {/* Display warning/error */}
    {fileName && !isLoading && !error && altitudeData.length > 0 && <p>Showing data for: <strong>{fileName}</strong></p>}


    {altitudeData.length > 0 && (
      <div className="chart-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Altitude Profile</h2>
          <div className="unit-toggle">
            <label>
              <input
                type="checkbox"
                checked={isMetric}
                onChange={() => setIsMetric(!isMetric)}
              />
              <span style={{ marginLeft: '5px' }}>{isMetric ? 'Metric' : 'Imperial'}</span>
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
              dataKey="displayAltitude"
              type="number"
              domain={['dataMin - 10', 'dataMax + 10']}
              label={{ 
                value: `Altitude (${altitudeUnit})`, 
                angle: -90, 
                position: 'insideLeft',
                dx: -15 
              }}
              allowDecimals={false}
            />
            <Tooltip
              formatter={(value, name) => [
                `${value.toFixed(1)} ${name === "Altitude" ? altitudeUnit : distanceUnit}`, 
                `Altitude`
              ]}
              labelFormatter={(label, items) => {
                const dataPoint = items[0]?.payload;
                const timeString = dataPoint?.timestamp ? 
                  formatTimestampForTooltip(dataPoint.timestamp) : '';
                return `Distance: ${label} ${distanceUnit}${timeString ? ` | Time: ${timeString}` : ''}`;
              }}
            />
            <Legend verticalAlign="top" height={36} />
            <Line
              type="monotone"
              dataKey="displayAltitude"
              name="Altitude" 
              stroke="#8884d8"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )}
    {altitudeData.length === 0 && !isLoading && !error && <p>Upload a FIT file to view the altitude profile.</p>}

  </div>
);
}

export default App;