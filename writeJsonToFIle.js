const fs = require('fs');

const writeJsonToFile = (data) => {
	// Convert JSON object to string
	const jsonString = JSON.stringify(data, null, 2);

	// Specify the file path where you want to write the JSON
	const filePath = 'output.json';

	// Write JSON string to file
	fs.writeFile(filePath, jsonString, (err) => {
		if (err) {
			console.error('Error writing JSON to file:', err);
			return;
		}
		console.log('JSON data has been written to', filePath);
	});
};

module.exports = writeJsonToFile;
