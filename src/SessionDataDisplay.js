import React from 'react';
import './SessionDataDisplay.css';

const SessionDataDisplay = ({ sessionData, isMetric }) => {
  if (!sessionData) {
    return null;
  }

  const metersToFeet = (meters) => (meters * 3.28084);
  const metersToMiles = (meters) => (meters * 0.000621371);
  const mpsToKph = (mps) => (mps * 3.6);
  const mpsToMph = (mps) => (mps * 2.23694);

  // Define which fields to display and their labels
  // Labels will be updated based on isMetric
  const getDisplayFields = () => ({
    startTime: 'Start Time',
    totalElapsedTime: 'Total Elapsed Time (hh:mm:ss)',
    totalTimerTime: 'Total Timer Time (hh:mm:ss)',
    totalDistance: `Total Distance (${isMetric ? 'km' : 'mi'})`,
    avgSpeed: `Average Speed (${isMetric ? 'km/h' : 'mph'})`,
    maxSpeed: `Max Speed (${isMetric ? 'km/h' : 'mph'})`,
    totalAscent: `Total Ascent (${isMetric ? 'm' : 'ft'})`,
    totalDescent: `Total Descent (${isMetric ? 'm' : 'ft'})`,
    minAltitude: `Min Altitude (${isMetric ? 'm' : 'ft'})`,
    avgAltitude: `Avg Altitude (${isMetric ? 'm' : 'ft'})`,
    maxAltitude: `Max Altitude (${isMetric ? 'm' : 'ft'})`,
    avgHeartRate: 'Average Heart Rate (bpm)',
    maxHeartRate: 'Max Heart Rate (bpm)',
    avgCadence: 'Average Cadence (rpm)',
    maxCadence: 'Max Cadence (rpm)',
    avgPower: 'Average Power (W)',
    maxPower: 'Max Power (W)',
    totalCalories: 'Total Calories (kcal)',
    normalizedPower: 'Normalized Power (W)',
    avgTemperature: `Avg Temperature (${isMetric ? '°C' : '°F'})`,
    maxTemperature: `Max Temperature (${isMetric ? '°C' : '°F'})`,
  });

  const displayFields = getDisplayFields();

  const formatValue = (key, value) => {
    if (value === undefined || value === null) return 'N/A';

    if (key === 'startTime' && value instanceof Date) {
      return value.toLocaleString();
    }

    if (typeof value === 'number') {
      switch (key) {
        case 'totalDistance':
          return isMetric ? (value / 1000).toFixed(2) : metersToMiles(value).toFixed(2);
        case 'avgSpeed':
        case 'maxSpeed':
          return isMetric ? mpsToKph(value).toFixed(1) : mpsToMph(value).toFixed(1);
        case 'totalAscent':
        case 'totalDescent':
        case 'minAltitude':
        case 'avgAltitude':
        case 'maxAltitude':
          return isMetric ? value.toFixed(0) : metersToFeet(value).toFixed(0);
        case 'avgTemperature':
        case 'maxTemperature': // Assuming input is Celsius from FIT SDK
          return isMetric ? value.toFixed(0) : ((value * 9/5) + 32).toFixed(0);
        case 'totalElapsedTime':
        case 'totalTimerTime':
            // convert seconds to HH:MM:SS
            const hours = Math.floor(value / 3600);
            const minutes = Math.floor((value % 3600) / 60);
            const seconds = Math.floor(value % 60);
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        default:
          return Number.isInteger(value) ? String(value) : value.toFixed(2);
      }
    }
    return String(value);
  };

  return (
    <div className="session-data-container">
      <h3>Reported Session Data</h3>
      <table className="session-data-table">
        <tbody>
          {Object.entries(displayFields).map(([key, label]) => {
            const rawValue = sessionData[key];
            // Skip rendering if the raw value is not present in sessionData, 
            // unless it's a field we always want to show (e.g., startTime)
            if (rawValue === undefined || rawValue === null) {
                 // Add exceptions here if some fields should always show N/A
                 // For now, we just skip fields not present in the data
                return null; 
            }
            const formattedValue = formatValue(key, rawValue);

            return (
              <tr key={key}>
                <td>{label}:</td>
                <td>{formattedValue}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default SessionDataDisplay;
