/* eslint-disable no-await-in-loop */
const { OpenAI } = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
//const { findConnectionByStreamSid } = require('./utils/api-gateway');
//const { postAudioBufferToTwilio, sendMarkMessageToTwilio } = require('./utils/twilio-stream');
const fs = require('fs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
	apiKey: OPENAI_API_KEY,
});

const awsConfig = {
	region: 'us-east-1',
};

const pollyClient = new PollyClient(awsConfig);

// reused from forwardAudio
const LANGUAGE_FRIENDLY_NAMES = {
	en: 'English',
	es: 'Spanish',
	fr: 'French',
};

const createOpenAIStream = async (textInput) => {
	const mp3 = await openai.audio.speech.create({
		model: 'tts-1',
		voice: 'echo',
		input: textInput,
	});
	return mp3.body;
};

const createAWSPollyStream = async (textInput, conversationLanguage) => {
	console.log('Creating audio stream with AWS Polly');
	const params = {
		OutputFormat: 'mp3',
		Text: textInput,
		// TODO dinamically change voiceId and LanguageCode
		VoiceId: 'Pedro',
		LanguageCode: 'es-US',
		Engine: 'neural',
	};
	console.log('AWS Polly params', params);
	const command = new SynthesizeSpeechCommand(params);
	console.log('AWS Polly command', command);
	const response = await pollyClient.send(command);
	console.log('AWS Polly audio stream');
	return response.AudioStream.on('data', (chunk) => {
		console.log('Received chunk of audio data');
		fs.appendFileSync('./audio.mp3', chunk);
	});
};

const createAudioFileFromText = async (textInput, conversationLanguage) => {
	console.log('Creating audio file from text', textInput);
	console.log('Conversation language', conversationLanguage);
	switch (conversationLanguage) {
		case LANGUAGE_FRIENDLY_NAMES.en:
			return createOpenAIStream(textInput);
		case LANGUAGE_FRIENDLY_NAMES.es:
			return createAWSPollyStream(textInput, conversationLanguage);
		case LANGUAGE_FRIENDLY_NAMES.fr:
			return createAWSPollyStream(textInput, conversationLanguage);
		default:
			return createOpenAIStream(textInput);
	}
};

const streamToWaveFile = (stream, connectionId, streamSid, conversationId) =>
	new Promise((resolve, reject) => {
		console.log('Converting to wav with ffmpeg');
		console.log(new Date());

		let audioBuffer = Buffer.alloc(0);

		const bufferingTime = 1; // in seconds
		const bufferSize = bufferingTime * 8000; // Since the frequency is 8000Hz

		ffmpeg()
			.setFfmpegPath('/opt/bin/ffmpeg')
			.setFfprobePath('/opt/bin/ffprobe')
			.input(stream)
			.audioCodec('pcm_mulaw')
			.audioChannels(1)
			.audioFrequency(8000)
			.toFormat('wav')
			.stream()
			.on('data', async (chunk) => {
				console.log('Received chunk of audio data');
				// from the first chunk, trim everything before the first occurrence of 'data'
				if (audioBuffer.length === 0) {
					const dataStart = chunk.indexOf('data');
					if (dataStart !== -1) {
						audioBuffer = chunk.slice(dataStart);
					}
				} else {
					audioBuffer = Buffer.concat([audioBuffer, chunk]);
				}

				while (audioBuffer.length >= bufferSize) {
					const chunkToSend = audioBuffer.slice(0, bufferSize);
					audioBuffer = audioBuffer.slice(bufferSize); // remove sent bytes from audio buffer

					//await postAudioBufferToTwilio(chunkToSend, connectionId, streamSid);
				}
			})
			.on('end', async () => {
				// send the last remaining chunk even if it's smaller than the target chunk size
				if (audioBuffer.length > 0) {
					//await postAudioBufferToTwilio(audioBuffer, connectionId, streamSid);
				}

				if (conversationId) {
					console.log('Sending mark message to Twilio');
					//await sendMarkMessageToTwilio(connectionId, streamSid, conversationId);
				}

				console.log('Finished converting to wav with ffmpeg');
				console.log(new Date());
				resolve();
			})
			.on('error', (error) => {
				console.log('ffmpeg error', error);
				reject(error);
			});
	});

const textToSpeech = async (streamSid, author, content, conversationId, conversationLanguage) => {
	if (author === 'interviewer') {
		const text = content.trim();

		if (text === '') {
			console.log('No audio generation needed for empty interviewer message');
			return;
		}

		const textToSpeechPayload = {
			text,
			streamSid,
		};

		//const streamConnection = await findConnectionByStreamSid(textToSpeechPayload.streamSid);

		const mp3Stream = await createAudioFileFromText(textToSpeechPayload.text, conversationLanguage);

		return;

		await streamToWaveFile(mp3Stream, /* streamConnection.connectionId.S */ '1', textToSpeechPayload.streamSid, conversationId);

		console.log('Audio generated successfully for interviewer message');
	} else {
		console.log('No audio generation needed for this event or author');
	}
};

module.exports.textToSpeech = async (event) => {
	try {
		console.log(event);
		// Expect text input to convert it to audio and streamsid to find connection and post to Twilio call
		const { conversation, message } = JSON.parse(event.body);

		console.log(conversation);

		await textToSpeech(conversation.streamSid, message.author, message.content, conversation.conversationId, conversation.metadata.conversation_language);
	} catch (e) {
		console.log(e);
	}

	return {};
};

module.exports.streamTextToSpeech = async (event) => {
	try {
		console.log(event);
		const { Records } = event;
		const failures = [];

		for (const record of Records) {
			/* const kinesisMessage = JSON.parse(Buffer.from(record.kinesis.data, 'base64').toString('utf-8'));
            console.log('Kinesis message', kinesisMessage); */

			const TESTING_DATA = JSON.parse(record.kinesis.data);

			const { llmEventType, conversationId, author, streamSid, message, sequenceNumber, conversationLanguage } = /* kinesisMessage */ TESTING_DATA;

			if (llmEventType === 'on_llm_stream') {
				try {
					// TODO: language in this kinesis message
					await textToSpeech(
						streamSid,
						author,
						message,
						// This is conversationId param but before it was empty despite being in the kinesis message. I left it as undefined
						undefined,
						conversationLanguage
					);
				} catch (error) {
					failures.push({ itemIdentifier: sequenceNumber });
				}
			} else if (llmEventType === 'on_llm_end') {
				//const streamConnection = await findConnectionByStreamSid(streamSid);
				//console.log('Sending mark message to Twilio', streamConnection.connectionId.S, streamSid, conversationId);
				//await sendMarkMessageToTwilio(streamConnection.connectionId.S, streamSid, conversationId);
			}
		}
		return {
			batchItemFailures: failures,
		};
	} catch (e) {
		console.log(e);
	}

	return {
		batchItemFailures: [],
	};
};
