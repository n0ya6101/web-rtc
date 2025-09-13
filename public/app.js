document.addEventListener('DOMContentLoaded', () => {
    function createVideoElement(id, stream, isLocal = false) {
        const videoContainer = document.createElement('div');
        videoContainer.id = sanitizeId(id); // Use sanitized ID for the container
        videoContainer.className = 'bg-gray-800 rounded-lg overflow-hidden relative aspect-video';
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true; // Essential for iOS
        video.muted = isLocal; // Only mute your own video
        video.className = 'w-full h-full object-cover';
        
        if (!isLocal) {
            video.classList.add('remote-video');
        }
        
        const label = document.createElement('div');
        label.className = 'absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm';
        // Use the original (unsanitized) ID for the label for better readability
        label.textContent = isLocal ? 'You' : `User ${id}`; 
        
        videoContainer.appendChild(video);
        videoContainer.appendChild(label);
        
        // --- THE FIX ---
        // Explicitly call play() to override browser autoplay restrictions.
        // The .catch() prevents errors if playback starts automatically.
        video.play().catch(error => {
            console.error(`Error attempting to play video for user ${id}:`, error);
            // You could show a "Click to play" overlay here as a fallback
        });

        return videoContainer;
    }

    function createPeerConnection(targetUserId, isInitiator) {
        const pc = new RTCPeerConnection(iceConfiguration);
        
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', { target: targetUserId, candidate: event.candidate, sender: socket.id });
            }
        };

        pc.ontrack = (event) => {
            handleRemoteStream(targetUserId, event.streams[0]);
            // NEW: Start quality management and stats display for the first connected peer
            if (!qualityManagers[targetUserId]) {
                qualityManagers[targetUserId] = new AdaptiveQualityManager(pc, (quality) => updateVideoConstraints(pc, quality));
                qualityManagers[targetUserId].start();
                if (!statsInterval) {
                    statsBox.classList.remove('hidden');
                    statsInterval = setInterval(showStats, 1000);
                }
            }
        };

        if (isInitiator) {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    socket.emit('offer', { target: targetUserId, sdp: pc.localDescription, sender: socket.id });
                })
                .catch(e => console.error("Error creating offer:", e));
        }
        return pc;
    }

    async function handleOffer(payload) { /* ... no changes ... */ }
    async function handleAnswer(payload) { /* ... no changes ... */ }
    async function handleIceCandidate(payload) { /* ... no changes ... */ }
    function handleRemoteStream(userId, stream) { /* ... no changes ... */ }
    function createVideoElement(id, stream, isLocal = false) { /* ... no changes ... */ }
    function sanitizeId(id) { /* ... no changes ... */ }
    async function toggleMic() { /* ... no changes ... */ }
    async function toggleVideo() { /* ... no changes ... */ }
    async function toggleScreenShare() { /* ... no changes ... */ }
    async function replaceVideoTrack(newTrack) { /* ... no changes ... */ }

    // NEW: Update video constraints based on quality manager feedback
    async function updateVideoConstraints(pc, quality) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (!sender) return;
        const params = sender.getParameters();
        params.encodings[0].maxBitrate = quality.videoBitrate;
        await sender.setParameters(params);
    }

    // NEW: Display stats from the first available quality manager
    function showStats() {
        const firstManagerId = Object.keys(qualityManagers)[0];
        if (firstManagerId && qualityManagers[firstManagerId]) {
            const manager = qualityManagers[firstManagerId];
            const stats = manager.currentStats;
            const quality = manager.getCurrentQuality();
            document.getElementById('bandwidthStat').textContent = `${Math.round(stats.bandwidth / 1000)} kbps`;
            document.getElementById('packetLossStat').textContent = `${(stats.packetLoss * 100).toFixed(2)} %`;
            document.getElementById('rttStat').textContent = `${stats.rtt} ms`;
            document.getElementById('qualityStat').textContent = quality.name;
        }
    }

    function cleanupPeerConnection(userId) {
        if (peerConnections[userId]) {
            peerConnections[userId].close();
            delete peerConnections[userId];
        }
        // NEW: Clean up quality manager and stats interval if needed
        if (qualityManagers[userId]) {
            qualityManagers[userId].stop();
            delete qualityManagers[userId];
        }
        const videoElement = document.getElementById(sanitizeId(userId));
        if (videoElement) {
            videoElement.remove();
        }
        // If no managers are left, hide stats
        if (Object.keys(qualityManagers).length === 0) {
            if(statsInterval) clearInterval(statsInterval);
            statsInterval = null;
            statsBox.classList.add('hidden');
        }
    }

    function leaveRoom() {
        if (socket) socket.disconnect();
        Object.keys(peerConnections).forEach(cleanupPeerConnection);
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        if (screenStream) screenStream.getTracks().forEach(track => track.stop());
        localStream = null;
        screenStream = null;
        videoGrid.innerHTML = '';
        controlsSection.style.display = 'none';
        joinSection.style.display = 'flex';
        roomNameInput.value = '';
        // NEW: Hide stats box on leave
        statsBox.classList.add('hidden');
        if(statsInterval) clearInterval(statsInterval);
        statsInterval = null;
    }
});

// NEW: AdaptiveQualityManager class from the previous version
class AdaptiveQualityManager {
    constructor(peerConnection, onQualityChange) {
        this.pc = peerConnection;
        this.onQualityChange = onQualityChange;
        this.monitoringInterval = null;
        this.qualityLevels = [
            { name: 'low', videoBitrate: 150000 },
            { name: 'medium', videoBitrate: 500000 },
            { name: 'high', videoBitrate: 1000000 }
        ];
        this.currentQualityIndex = 1;
        this.currentStats = { bandwidth: 500000, packetLoss: 0, rtt: 50 };
        this.lastStats = null;
    }
    start() { this.monitoringInterval = setInterval(() => this.monitor(), 2000); }
    stop() { clearInterval(this.monitoringInterval); }
    getCurrentQuality() { return this.qualityLevels[this.currentQualityIndex]; }
    async monitor() {
        if (!this.pc || this.pc.connectionState !== 'connected') return;
        const stats = await this.pc.getStats(null);
        this.analyzeStats(stats);
        this.adaptQuality();
    }
    analyzeStats(stats) {
        let outboundRtp = null;
        stats.forEach(report => {
            if (report.type === 'outbound-rtp' && report.mediaType === 'video') outboundRtp = report;
            if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
                const packetLoss = report.packetsLost / (report.packetsReceived + report.packetsLost) || 0;
                this.currentStats.packetLoss = (this.currentStats.packetLoss * 0.9) + (packetLoss * 0.1); // smoothing
            }
             if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                this.currentStats.rtt = report.currentRoundTripTime * 1000;
             }
        });
        if (outboundRtp && this.lastStats) {
            const timeDiff = (outboundRtp.timestamp - this.lastStats.timestamp) / 1000;
            const bytesDiff = outboundRtp.bytesSent - this.lastStats.bytesSent;
            if (timeDiff > 0) this.currentStats.bandwidth = Math.round((bytesDiff * 8) / timeDiff);
        }
        this.lastStats = outboundRtp;
    }
    adaptQuality() {
        const currentBitrate = this.getCurrentQuality().videoBitrate;
        // Downgrade
        if ((this.currentStats.packetLoss > 0.1 || this.currentStats.bandwidth < currentBitrate) && this.currentQualityIndex > 0) {
            this.currentQualityIndex--;
            this.onQualityChange(this.getCurrentQuality());
        } 
        // Upgrade
        else if (this.currentStats.packetLoss < 0.05 && this.currentQualityIndex < this.qualityLevels.length - 1) {
            const nextQuality = this.qualityLevels[this.currentQualityIndex + 1];
            if (this.currentStats.bandwidth > nextQuality.videoBitrate * 1.2) {
                 this.currentQualityIndex++;
                 this.onQualityChange(this.getCurrentQuality());
            }
        }
    }
}
// Stubs for brevity - these are small utility functions from the original full file
function handleMediaError(error) { let msg = "Could not access media devices."; if(error.name === 'NotAllowedError') msg="Permission denied."; alert(msg); }
function updateControlButtonStates() { /* Manages button disabled/enabled states */ }
async function handleOffer(payload) { const pc = peerConnections[payload.sender]; await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('answer', { target: payload.sender, sdp: pc.localDescription, sender: socket.id }); }
async function handleAnswer(payload) { await peerConnections[payload.sender].setRemoteDescription(new RTCSessionDescription(payload.sdp)); }
async function handleIceCandidate(payload) { if (payload.candidate) await peerConnections[payload.sender].addIceCandidate(new RTCIceCandidate(payload.candidate)); }
function handleRemoteStream(userId, stream) { let videoContainer = document.getElementById(sanitizeId(userId)); if (!videoContainer) { videoContainer = createVideoElement(sanitizeId(userId), stream, false); videoGrid.appendChild(videoContainer); } else { videoContainer.querySelector('video').srcObject = stream; } }
function createVideoElement(id, stream, isLocal = false) { const c = document.createElement('div'); c.id = id; c.className = 'bg-gray-800 rounded-lg overflow-hidden relative aspect-video'; const v = document.createElement('video'); v.srcObject = stream; v.autoplay = true; v.playsInline = true; v.muted = isLocal; v.className = 'w-full h-full object-cover' + (isLocal ? '' : ' remote-video'); c.appendChild(v); return c; }
function sanitizeId(id) { return id.replace(/[^a-zA-Z0-9-_]/g, '_'); }
async function toggleMic() { localStream.getAudioTracks()[0].enabled = !localStream.getAudioTracks()[0].enabled; }
async function toggleVideo() { localStream.getVideoTracks()[0].enabled = !localStream.getVideoTracks()[0].enabled; }
async function toggleScreenShare() { alert('Screen sharing is a future feature!'); }
async function replaceVideoTrack(newTrack) { /* logic to replace video track for screensharing */ }


