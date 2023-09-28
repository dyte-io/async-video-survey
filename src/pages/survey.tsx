/* eslint-disable react-hooks/exhaustive-deps */
import {
  DyteDialogManager,
  DyteParticipantTile,
  DyteRecordingToggle,
  DyteSettingsToggle,
  DyteSpinner,
  provideDyteDesignSystem,
} from '@dytesdk/react-ui-kit';
import {
  DyteProvider,
  useDyteClient,
  useDyteMeeting,
  useDyteSelector,
} from '@dytesdk/react-web-core';
import { Dispatch, useEffect, useReducer, useState } from 'react';
import { getBrightness, getElapsedDuration } from '@/utils';
import Duration from '@/components/Duration';
import Head from 'next/head';

function LoadingUI() {
  return (
    <div className="flex h-full w-full flex-col place-items-center justify-center gap-4">
      <DyteSpinner className="h-14 w-14 text-blue-500" />
      <p className="text-xl font-semibold">Starting Dyte Video Survey</p>
    </div>
  );
}

function useBrightnessAndSilenceDetector(
  dispatchError: Dispatch<Parameters<typeof errorReducer>[1]>
) {
  const { meeting } = useDyteMeeting();
  const videoEnabled = useDyteSelector((m) => m.self.videoEnabled);
  const audioEnabled = useDyteSelector((m) => m.self.audioEnabled);

  useEffect(() => {
    const { audioTrack } = meeting.self;
    if (!audioTrack || !audioEnabled) return;

    const stream = new MediaStream();
    stream.addTrack(audioTrack);
    const audioContext = new AudioContext();
    audioContext.resume();
    const analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    const micSource = audioContext.createMediaStreamSource(stream);
    micSource.connect(analyserNode);
    const bufferLength = 2048;
    const dataArray = new Float32Array(bufferLength);
    const silenceThreshold = 0.05;
    const segmentLength = 1024;

    function getRMS(
      dataArray: Float32Array,
      startIndex: number,
      endIndex: number
    ) {
      let sum = 0;
      for (let i = startIndex; i < endIndex; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const mean = sum / (endIndex - startIndex);
      const rms = Math.sqrt(mean);
      return rms;
    }

    function detectSilence() {
      analyserNode.getFloatTimeDomainData(dataArray);
      const numSegments = Math.floor(bufferLength / segmentLength);
      for (let i = 0; i < numSegments; i++) {
        const startIndex = i * segmentLength;
        const endIndex = (i + 1) * segmentLength;
        const rms = getRMS(dataArray, startIndex, endIndex);
        if (rms > silenceThreshold) {
          // Detected non-silence in this segment
          return false;
        }
      }
      // Detected silence
      return true;
    }

    const interval = setInterval(() => {
      const isSilent = detectSilence();

      if (isSilent) {
        dispatchError({ type: 'add', error: 'not_loud' });
      } else {
        dispatchError({ type: 'remove', error: 'not_loud' });
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      dispatchError({ type: 'remove', error: 'not_loud' });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioEnabled]);

  useEffect(() => {
    if (!videoEnabled) return;

    const { videoTrack } = meeting.self;
    if (!videoTrack) return;
    const videoStream = new MediaStream();
    videoStream.addTrack(videoTrack);
    const video = document.createElement('video');
    video.style.width = '240px';
    video.style.height = '180px';
    video.muted = true;
    video.srcObject = videoStream;
    video.play();
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 180;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const interval = setInterval(() => {
      const brightness = getBrightness(video, canvas, ctx);
      if (brightness < 0.4) {
        dispatchError({ type: 'add', error: 'not_bright' });
      } else {
        dispatchError({ type: 'remove', error: 'not_bright' });
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      dispatchError({ type: 'remove', error: 'not_bright' });
    };
  }, [videoEnabled]);

  return null;
}

type MyError = 'not_bright' | 'not_loud';
type State = 'ok' | MyError;

function errorReducer(
  state: MyError[],
  action: { type: 'add' | 'remove'; error: MyError }
) {
  switch (action.type) {
    case 'add':
      if (!state.includes(action.error)) {
        return [...state, action.error];
      }
      break;
    case 'remove':
      return state.filter((e) => e !== action.error);
  }
  return state;
}

const messages = {
  ok: 'Ensure your head and shoulders are in shot. Hit record when you are ready.',
  not_bright:
    'You seem to be in a dark room, please try turning on the lights.',
  not_loud: 'Your voice is not loud enough. Please speak loud and clearly.',
};

function Survey() {
  const { meeting } = useDyteMeeting();
  const roomJoined = useDyteSelector((m) => m.self.roomJoined);

  const [timestamp, setTimestamp] = useState<Date>();
  const [recordingDisabled, setRecordingDisabled] = useState(false);
  const [UIStates, setUIStates] = useState<any>({});

  const [duration, setDuration] = useState(0);
  const [errors, dispatchError] = useReducer(errorReducer, []);

  useBrightnessAndSilenceDetector(dispatchError);

  useEffect(() => {
    // calculate duration from recording timestamp
    if (timestamp) {
      const interval = setInterval(() => {
        const duration = getElapsedDuration(timestamp);
        setDuration(duration);
      }, 500);
      return () => {
        clearInterval(interval);
      };
    }
  }, [timestamp]);

  useEffect(() => {
    const onRecordingUpdate = (state: string) => {
      switch (state) {
        case 'RECORDING':
          setTimestamp(new Date());
          break;
        case 'STOPPING':
          setTimestamp(undefined);
          break;
      }
    };

    meeting.recording.addListener('recordingUpdate', onRecordingUpdate);
    return () => {
      meeting.recording.removeListener('recordingUpdate', onRecordingUpdate);
    };
  }, []);

  useEffect(() => {
    // stop recording when you reach max duration of 60 seconds
    if (duration >= 60) {
      meeting.recording.stop();
      setRecordingDisabled(false);
    }
  }, [duration]);

  if (!roomJoined) {
    return <LoadingUI />;
  }

  return (
    <div className="flex h-full w-full flex-col place-items-center justify-center p-4">
      <div className="max-w-4xl pb-8">
        <h3 className="mb-4 text-xl font-bold">
          Have you worked with any of the following technologies: JavaScript
          Core, Web Assembly, Protobufs?{' '}
        </h3>
        <div className="mb-2">
          List out the ones you have experience in and pick 1 to elaborate. If
          you haven&apos;t worked with any of these technologies, pick 2-3 skills
          mentioned in the job description to describe instead. Here are some
          tips to help you record a great video:
        </div>
        <li>Please provide as much detail as you can</li>
        <li>Use your webcam or mobile camera to record your video response</li>
        <li>Make sure you have plenty of light so we can clearly see you</li>
        <li>
          Avoid places with lots of background noise so we can clearly hear you
        </li>
      </div>
      <div className="flex w-full max-w-lg flex-col overflow-clip rounded-xl border">
        <div className="relative">
          <DyteParticipantTile
            participant={meeting.self}
            meeting={meeting}
            className="aspect-[3/2] h-auto w-full rounded-none bg-zinc-300"
            style={{ background: '#000' }}
          />
          <p className="bg-purple-950 p-3 text-center text-xs text-white">
            {/* Show okay message, or last error message */}
            {errors.length === 0
              ? messages['ok']
              : messages[errors[errors.length - 1]! as State]}
          </p>
          {/* Show placement container only when recording hasn't started */}
          {!timestamp && (
            <div className="absolute left-1/2 top-1/2 z-50 aspect-square w-44 -translate-x-1/2 -translate-y-28 rounded-lg border-2 border-dashed border-pink-50" />
          )}
        </div>
        {/* Duration indicator */}
        <Duration duration={duration} />

        <div className="flex items-center justify-center p-2">
          <DyteRecordingToggle
            meeting={meeting}
            disabled={(timestamp && duration <= 15) || recordingDisabled}
          />
          <DyteSettingsToggle
            onDyteStateUpdate={(e) => setUIStates(e.detail)}
          />
        </div>
      </div>

      <DyteDialogManager
        states={UIStates}
        meeting={meeting}
        onDyteStateUpdate={(e) => setUIStates(e.detail)}
      />
    </div>
  );
}

export default function SurveyPage() {
  const [meeting, initMeeting] = useDyteClient();

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);

    const authToken = search.get('token');

    provideDyteDesignSystem(document.body, {
      theme: 'light',
    });

    if (!authToken) {
      return alert('authToken was not passed');
    }

    initMeeting({
      authToken,
    }).then((m) => m?.joinRoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Head>
        <title>Async Video Survey</title>
      </Head>
      <DyteProvider value={meeting} fallback={<div>Loading...</div>}>
        <Survey />
      </DyteProvider>
    </>
  );
}
