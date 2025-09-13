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
    let screenStream;
    let roomName;
    const peerConnections = {};
    const pendingIceCandidates = {}; // Queue ICE candidates until remote description is set

    // --- ICE SERVER CONFIGURATION ---
    const iceConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: "turn:openrelay.metered.ca:80",
                username: "openrelayproject",
                credential: "openrelayproject",
            },
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
    shareScreenButton.addEventListener('click', toggleScreenShare);
    leaveButton.addEventListener('click', leaveRoom);

    // --- CORE LOGIC ---

    async function joinRoom(rn, startWithVideo, startWithAudio) {
        roomName = rn;
        joinSection.style.display = 'none';
        controlsSection.style.display = 'flex';
        roomDisplay.textContent = roomName;

        connectSocket();

        if (startWithVideo || startWithAudio) {
            try {
                const constraints = { 
                    video: startWithVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false, 
                    audio: startWithAudio ? { echoCancellation: true, noiseSuppression: true } : false 
                };
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log("Media stream obtained.");

                const localVideoElement = createVideoElement('local', localStream, true);
                videoGrid.appendChild(localVideoElement);
                
                updateControlButtonStates();

            } catch (error) {
                console.error("Error accessing media devices.", error);
                handleMediaError(error);
            }
        } else {
            console.log("Joining as a spectator.");
            updateControlButtonStates();
        }
    }
    
    function handleMediaError(error) {
        let errorMessage = "Could not access camera and microphone.";
        switch(error.name) {
            case 'NotAllowedError':
                errorMessage = "Permission denied. Please allow camera and microphone access.";
                break;
            case 'NotFoundError':
                errorMessage = "No camera or microphone found.";
                break;
            case 'NotReadableError':
                errorMessage = "Camera or microphone is being used by another application.";
                break;
            case 'SecurityError':
                errorMessage = "Security error. Please use HTTPS or localhost.";
                break;
        }
        alert(errorMessage);
        updateControlButtonStates();
    }

    function updateControlButtonStates() {
        const hasVideo = localStream && localStream.getVideoTracks().length > 0;
        const hasAudio = localStream && localStream.getAudioTracks().length > 0;
        
        toggleVideoButton.disabled = !hasVideo;
        toggleMicButton.disabled = !hasAudio;
        
        if (hasVideo) {
            const videoTrack = localStream.getVideoTracks()[0];
            toggleVideoButton.textContent = videoTrack.enabled ? 'Disable Video' : 'Enable Video';
            toggleVideoButton.className = videoTrack.enabled ? 
                'bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors' :
                'bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors';
        }
        
        if (hasAudio) {
            const audioTrack = localStream.getAudioTracks()[0];
            toggleMicButton.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
            toggleMicButton.className = audioTrack.enabled ? 
                'bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors' :
                'bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors';
        }
    }

    function connectSocket() {
        socket = io();

        socket.on('connect', () => {
            console.log('Connected to signaling server with ID:', socket.id);
            socket.emit('join-room', roomName);
        });
        
        socket.on('existing-users', (userIds) => {
            console.log('Existing users in room:', userIds);
            userIds.forEach(userId => {
                // Use consistent rule: lower socket.id initiates
                const shouldInitiate = socket.id < userId;
                peerConnections[userId] = createPeerConnection(userId, shouldInitiate);
            });
        });

        socket.on('user-connected', (userId) => {
            console.log('New user connected:', userId);
            // Use consistent rule: lower socket.id initiates
            const shouldInitiate = socket.id < userId;
            peerConnections[userId] = createPeerConnection(userId, shouldInitiate);
        });

        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);
        socket.on('track-update', handleTrackUpdate);

        socket.on('user-disconnected', (userId) => {
            console.log('User disconnected:', userId);
            cleanupPeerConnection(userId);
        });
    }

    function createPeerConnection(targetUserId, isInitiator) {
        console.log(`Creating peer connection to ${targetUserId}, initiator: ${isInitiator}`);
        const pc = new RTCPeerConnection(iceConfiguration);

        // Initialize pending ICE candidates for this connection
        pendingIceCandidates[targetUserId] = [];

        // Add local tracks if they exist
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
                console.log(`Added ${track.kind} track to peer connection`);
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
            console.log(`Received remote track from ${targetUserId}`);
            handleRemoteStream(targetUserId, event.streams[0]);
        };

        pc.onconnectionstatechange = () => {
            console.log(`Connection state with ${targetUserId}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed') {
                console.log(`Connection failed with ${targetUserId}, attempting restart`);
                restartPeerConnection(targetUserId);
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${targetUserId}: ${pc.iceConnectionState}`);
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
        let pc = peerConnections[payload.sender];
        
        if (!pc) {
            pc = createPeerConnection(payload.sender, false);
            peerConnections[payload.sender] = pc;
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            
            // Process any pending ICE candidates
            await processPendingIceCandidates(payload.sender);
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            socket.emit('answer', {
                target: payload.sender,
                sdp: pc.localDescription,
                sender: socket.id
            });
        } catch (error) {
            console.error("Error handling offer:", error);
        }
    }

    async function handleAnswer(payload) {
        console.log(`Received answer from ${payload.sender}`);
        const pc = peerConnections[payload.sender];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                // Process any pending ICE candidates
                await processPendingIceCandidates(payload.sender);
            } catch (error) {
                console.error("Error handling answer:", error);
            }
        }
    }

    async function handleIceCandidate(payload) {
        const pc = peerConnections[payload.sender];
        if (pc && payload.candidate) {
            if (pc.remoteDescription) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                } catch (e) {
                    console.error('Error adding ICE candidate:', e);
                }
            } else {
                // Queue the candidate until remote description is set
                if (!pendingIceCandidates[payload.sender]) {
                    pendingIceCandidates[payload.sender] = [];
                }
                pendingIceCandidates[payload.sender].push(payload.candidate);
            }
        }
    }

    async function processPendingIceCandidates(userId) {
        const pc = peerConnections[userId];
        const candidates = pendingIceCandidates[userId] || [];
        
        for (const candidate of candidates) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('Error adding queued ICE candidate:', e);
            }
        }
        
        // Clear the queue
        pendingIceCandidates[userId] = [];
    }

    function handleRemoteStream(userId, stream) {
        let videoContainer = document.getElementById(sanitizeId(userId));
        if (!videoContainer) {
            videoContainer = createVideoElement(sanitizeId(userId), stream, false);
            videoGrid.appendChild(videoContainer);
        } else {
            // Update existing video element
            const video = videoContainer.querySelector('video');
            if (video) {
                video.srcObject = stream;
            }
        }
    }

    function handleTrackUpdate(payload) {
        console.log(`User ${payload.sender} updated their tracks`);
        // This could be used to show visual indicators when users mute/unmute
    }

    function createVideoElement(id, stream, isLocal = false) {
        const videoContainer = document.createElement('div');
        videoContainer.id = id;
        videoContainer.className = 'bg-gray-800 rounded-lg overflow-hidden relative aspect-video';
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = isLocal;
        video.className = 'w-full h-full object-cover';
        
        if (!isLocal) {
            video.classList.add('remote-video');
        }
        
        const label = document.createElement('div');
        label.className = 'absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm';
        label.textContent = isLocal ? 'You' : `User ${id}`;
        
        videoContainer.appendChild(video);
        videoContainer.appendChild(label);
        
        return videoContainer;
    }

    function sanitizeId(id) {
        return id.replace(/[^a-zA-Z0-9-_]/g, '_');
    }

    async function toggleMic() {
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                addTracksToAllConnections();
            } catch (error) {
                console.error("Error accessing microphone:", error);
                return;
            }
        }
        
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            updateControlButtonStates();
            notifyTrackUpdate();
        }
    }

    async function toggleVideo() {
        if (!localStream || localStream.getVideoTracks().length === 0) {
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                if (!localStream) {
                    localStream = videoStream;
                } else {
                    // Add video track to existing stream
                    videoStream.getVideoTracks().forEach(track => {
                        localStream.addTrack(track);
                    });
                }
                addTracksToAllConnections();
                
                // Update local video element
                const localVideoContainer = document.getElementById('local');
                if (!localVideoContainer) {
                    const videoElement = createVideoElement('local', localStream, true);
                    videoGrid.appendChild(videoElement);
                }
            } catch (error) {
                console.error("Error accessing camera:", error);
                return;
            }
        }
        
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            updateControlButtonStates();
            notifyTrackUpdate();
        }
    }

    async function toggleScreenShare() {
        if (screenStream) {
            // Stop screen sharing
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
            
            // Replace with camera stream
            if (localStream && localStream.getVideoTracks().length > 0) {
                await replaceVideoTrack(localStream.getVideoTracks()[0]);
            }
            
            shareScreenButton.textContent = 'Share Screen';
            shareScreenButton.className = 'bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors';
        } else {
            // Start screen sharing
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                await replaceVideoTrack(screenStream.getVideoTracks()[0]);
                
                shareScreenButton.textContent = 'Stop Sharing';
                shareScreenButton.className = 'bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg transition-colors';
                
                // Handle screen share ending
                screenStream.getVideoTracks()[0].onended = () => {
                    toggleScreenShare();
                };
            } catch (error) {
                console.error("Error sharing screen:", error);
            }
        }
    }

    async function replaceVideoTrack(newTrack) {
        // Replace track in local stream
        const oldTrack = localStream?.getVideoTracks()[0];
        if (oldTrack) {
            localStream.removeTrack(oldTrack);
            oldTrack.stop();
        }
        
        if (localStream) {
            localStream.addTrack(newTrack);
        } else {
            localStream = new MediaStream([newTrack]);
        }
        
        // Update local video
        const localVideo = document.querySelector('#local video');
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
        
        // Replace track in all peer connections
        for (const userId in peerConnections) {
            const pc = peerConnections[userId];
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                try {
                    await sender.replaceTrack(newTrack);
                } catch (error) {
                    console.error(`Error replacing track for ${userId}:`, error);
                }
            }
        }
    }

    function addTracksToAllConnections() {
        if (!localStream) return;
        
        for (const userId in peerConnections) {
            const pc = peerConnections[userId];
            localStream.getTracks().forEach(track => {
                const existingSender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                if (!existingSender) {
                    pc.addTrack(track, localStream);
                }
            });
        }
    }

    function notifyTrackUpdate() {
        if (socket) {
            socket.emit('track-update', {
                sender: socket.id,
                hasVideo: localStream && localStream.getVideoTracks().some(t => t.enabled),
                hasAudio: localStream && localStream.getAudioTracks().some(t => t.enabled)
            });
        }
    }

    function restartPeerConnection(userId) {
        cleanupPeerConnection(userId);
        setTimeout(() => {
            const shouldInitiate = socket.id < userId;
            peerConnections[userId] = createPeerConnection(userId, shouldInitiate);
        }, 1000);
    }

    function cleanupPeerConnection(userId) {
        if (peerConnections[userId]) {
            peerConnections[userId].close();
            delete peerConnections[userId];
        }
        
        if (pendingIceCandidates[userId]) {
            delete pendingIceCandidates[userId];
        }
        
        const videoElement = document.getElementById(sanitizeId(userId));
        if (videoElement) {
            videoElement.remove();
        }
    }

    function leaveRoom() {
        if (socket) {
            socket.disconnect();
        }
        
        // Cleanup all peer connections
        Object.keys(peerConnections).forEach(userId => {
            cleanupPeerConnection(userId);
        });

        // Stop all media streams
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }

        // Reset UI
        videoGrid.innerHTML = '';
        controlsSection.style.display = 'none';
        joinSection.style.display = 'flex';
        roomNameInput.value = '';
        
        // Reset button states
        shareScreenButton.textContent = 'Share Screen';
        shareScreenButton.className = 'bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors';
    }
});