document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENT REFERENCES ---
    const joinSection = document.getElementById('join-section');
    const roomNameInput = document.getElementById('room-name');
    const joinButton = document.getElementById('join-button');
    const enableCameraCheckbox = document.getElementById('enable-camera-checkbox');
    const enableMicCheckbox = document.getElementById('enable-mic-checkbox');
    const controlsSection = document.getElementById('controls-section');
    const roomDisplay = document.getElementById('room-display');
    const videoGrid = document.getElementById('video-grid');
    const toggleMicButton = document.getElementById('toggle-mic-button');
    const toggleVideoButton = document.getElementById('toggle-video-button');
    const shareScreenButton = document.getElementById('share-screen-button');
    const leaveButton = document.getElementById('leave-button');

    // --- STATE MANAGEMENT ---
    let socket;
    let localStream;
    let roomName;
    const peerConnections = {}; // Key: socketId of remote user, Value: RTCPeerConnection

    // --- ICE SERVER CONFIGURATION ---
    const iceConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // --- EVENT LISTENERS ---
    joinButton.addEventListener('click', () => {
        const rn = roomNameInput.value.trim();
        if (rn) {
            joinRoom(rn, enableCameraCheckbox.checked, enableMicCheckbox.checked);
        }
    });
    toggleMicButton.addEventListener('click', toggleMic);
    toggleVideoButton.addEventListener('click', toggleVideo);
    leaveButton.addEventListener('click', leaveRoom);
    shareScreenButton.addEventListener('click', () => alert('Screen sharing functionality is under development.'));


    // --- CORE LOGIC ---

    async function joinRoom(rn, startWithVideo, startWithAudio) {
        roomName = rn;
        joinSection.style.display = 'none';
        controlsSection.style.display = 'flex';
        roomDisplay.textContent = roomName;

        connectSocket();

        if (startWithVideo || startWithAudio) {
            try {
                const constraints = { video: startWithVideo, audio: startWithAudio };
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log("Media stream obtained.");

                const localVideoElement = createVideoElement('local', localStream, true);
                videoGrid.appendChild(localVideoElement);
                
                toggleVideoButton.disabled = !startWithVideo;
                toggleMicButton.disabled = !startWithAudio;
                
                if (!startWithVideo) localStream.getVideoTracks()[0].enabled = false;
                if (!startWithAudio) localStream.getAudioTracks()[0].enabled = false;

            } catch (error) {
                console.error("Error accessing media devices.", error);
                handleMediaError(error);
                // Allow joining the room as a spectator even if media fails
            }
        } else {
             console.log("Joining as a spectator.");
        }
    }
    
    function handleMediaError(error) {
        let errorMessage = "Could not access camera and microphone. Please check your hardware and browser settings.";
        switch(error.name) {
            case 'NotAllowedError':
                errorMessage = "Permission Denied: You have blocked this site from accessing your camera and microphone. Please click the camera icon in the address bar to change permissions.";
                break;
            case 'NotFoundError':
                errorMessage = "No Devices Found: Your browser could not find a camera or microphone. Please make sure they are connected and enabled.";
                break;
            case 'NotReadableError':
                errorMessage = "Hardware Error: Your camera or microphone is currently being used by another application or there is a problem with your drivers.";
                break;
            case 'SecurityError':
                 errorMessage = "Security Error: Access to camera and microphone is only allowed on secure connections (HTTPS or localhost). Please check the URL.";
                 break;
        }
        alert(errorMessage);
    }

    function connectSocket() {
        socket = io();

        socket.on('connect', () => {
            console.log('Connected to signaling server with ID:', socket.id);
            socket.emit('join-room', roomName, socket.id);
        });
        
        socket.on('existing-users', (userIds) => {
            console.log('Existing users in room:', userIds);
            userIds.forEach(userId => {
                peerConnections[userId] = createPeerConnection(userId, true);
            });
        });

        socket.on('user-connected', (userId) => {
            console.log('New user connected:', userId);
            peerConnections[userId] = createPeerConnection(userId, false);
        });

        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);

        socket.on('user-disconnected', (userId) => {
            console.log('User disconnected:', userId);
            if (peerConnections[userId]) {
                peerConnections[userId].close();
                delete peerConnections[userId];
            }
            const videoElement = document.getElementById(userId);
            if (videoElement) {
                videoElement.remove();
            }
        });
    }

    function createPeerConnection(targetUserId, isInitiator) {
        console.log(`Creating peer connection to ${targetUserId}, initiator: ${isInitiator}`);
        const pc = new RTCPeerConnection(iceConfiguration);

        // Add local tracks if they exist
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    target: targetUserId,
                    candidate: event.candidate,
                    sender: socket.id
                });
            }
        };

        pc.ontrack = (event) => {
            let videoContainer = document.getElementById(targetUserId);
            if (!videoContainer) {
                videoContainer = createVideoElement(targetUserId, event.streams[0]);
                videoGrid.appendChild(videoContainer);
            }
        };

        if (isInitiator) {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    socket.emit('offer', {
                        target: targetUserId,
                        sdp: pc.localDescription,
                        sender: socket.id
                    });
                })
                .catch(e => console.error("Error creating offer:", e));
        }

        return pc;
    }

    async function handleOffer(payload) {
        console.log(`Received offer from ${payload.sender}`);
        const pc = peerConnections[payload.sender];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', {
                target: payload.sender,
                sdp: pc.localDescription,
                sender: socket.id
            });
        }
    }

    async function handleAnswer(payload) {
        console.log(`Received answer from ${payload.sender}`);
        const pc = peerConnections[payload.sender];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
    }

    async function handleIceCandidate(payload) {
        const pc = peerConnections[payload.sender];
        if (pc && payload.candidate) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch (e) {
                console.error('Error adding ICE candidate', e);
            }
        }
    }

    function createVideoElement(id, stream, isLocal = false) {
        const videoContainer = document.createElement('div');
        videoContainer.id = id;
        videoContainer.classList.add('bg-gray-800', 'rounded-lg', 'overflow-hidden', 'relative');
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = isLocal;
        if (!isLocal) {
            video.classList.add('remote-video');
        }
        videoContainer.appendChild(video);
        return videoContainer;
    }

    function toggleMic() {
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (!audioTrack) return;
        
        audioTrack.enabled = !audioTrack.enabled;
        const isMuted = !audioTrack.enabled;
        toggleMicButton.textContent = isMuted ? 'Unmute Mic' : 'Mute Mic';
        toggleMicButton.classList.toggle('bg-red-500', isMuted);
        toggleMicButton.classList.toggle('bg-blue-500', !isMuted);
    }

    function toggleVideo() {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (!videoTrack) return;

        videoTrack.enabled = !videoTrack.enabled;
        const isEnabled = videoTrack.enabled;
        toggleVideoButton.textContent = isEnabled ? 'Disable Video' : 'Enable Video';
        toggleVideoButton.classList.toggle('bg-red-500', !isEnabled);
        toggleVideoButton.classList.toggle('bg-blue-500', isEnabled);
    }

    function leaveRoom() {
        if (socket) {
            socket.disconnect();
        }
        for (const userId in peerConnections) {
            if (peerConnections[userId]) {
                peerConnections[userId].close();
            }
        }
        // Reset state
        Object.keys(peerConnections).forEach(key => delete peerConnections[key]);

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        videoGrid.innerHTML = '';
        controlsSection.style.display = 'none';
        joinSection.style.display = 'flex';
        roomNameInput.value = '';
    }
});

