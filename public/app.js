document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENT REFERENCES ---
    const joinSection = document.getElementById('join-section');
    const roomNameInput = document.getElementById('room-name');
    const joinButton = document.getElementById('join-button');
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
    let isMicMuted = false;
    let isVideoEnabled = true;

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
            joinRoom(rn);
        }
    });
    toggleMicButton.addEventListener('click', toggleMic);
    toggleVideoButton.addEventListener('click', toggleVideo);
    leaveButton.addEventListener('click', leaveRoom);
    shareScreenButton.addEventListener('click', () => alert('Screen sharing functionality is under development.'));


    // --- CORE LOGIC ---

    async function joinRoom(rn) {
        roomName = rn;
        joinSection.style.display = 'none';
        controlsSection.style.display = 'flex';
        roomDisplay.textContent = roomName;

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            const localVideoElement = createVideoElement(socket ? socket.id : 'local', localStream, true);
            videoGrid.appendChild(localVideoElement);
            // If we get the stream, we can connect the socket
            connectSocket();
        } catch (error) {
            console.error("Error accessing media devices.", error);
            // NEW: Enhanced error handling
            handleMediaError(error);
            leaveRoom(); // Revert UI changes
            return;
        }
    }

    // NEW: Function to provide specific feedback for media errors
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
        // --- ... existing connectSocket logic ... ---
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

        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });

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
            let videoElement = document.getElementById(targetUserId);
            if (!videoElement) {
                videoElement = createVideoElement(targetUserId, event.streams[0]);
                videoGrid.appendChild(videoElement);
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
        if (isLocal) {
            video.muted = true;
        } else {
            video.classList.add('remote-video');
        }
        videoContainer.appendChild(video);
        return videoContainer;
    }

    function toggleMic() {
        isMicMuted = !isMicMuted;
        localStream.getAudioTracks()[0].enabled = !isMicMuted;
        toggleMicButton.textContent = isMicMuted ? 'Unmute Mic' : 'Mute Mic';
        toggleMicButton.classList.toggle('bg-red-500', isMicMuted);
    }

    function toggleVideo() {
        isVideoEnabled = !isVideoEnabled;
        localStream.getVideoTracks()[0].enabled = isVideoEnabled;
        toggleVideoButton.textContent = isVideoEnabled ? 'Disable Video' : 'Enable Video';
        toggleVideoButton.classList.toggle('bg-red-500', !isVideoEnabled);
    }

    function leaveRoom() {
        if (socket) {
            socket.disconnect();
        }
        for (const userId in peerConnections) {
            peerConnections[userId].close();
        }
        const peerConnections = {};

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        videoGrid.innerHTML = '';
        controlsSection.style.display = 'none';
        joinSection.style.display = 'flex';
        roomNameInput.value = '';
    }
});

