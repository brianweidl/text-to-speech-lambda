require('dotenv').config();
const streamTextToSpeech = require('./textToSpeech').streamTextToSpeech;

const data = require('./data.json');

const stringifyData = JSON.stringify(data);

const decodedData = JSON.parse(stringifyData);

const kinesisFormattedData = {
	Records: decodedData.map((record) => {
		return {
			kinesis: {
				data: JSON.stringify(record),
			},
		};
	}),
};

streamTextToSpeech(kinesisFormattedData);
