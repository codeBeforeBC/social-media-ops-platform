/** Shared by browser extraction and the detached-DOM regression harness. */
export function classifyDetailMedia(panel) {
  const main = panel?.querySelector('.media-container');
  if (!main) return { type: 'unknown', has_live_photo: false };
  // Live Photo videos belong to an image-carousel slide. A <video> tag is
  // therefore not sufficient evidence that the note itself is a video note.
  const imageCarousel = Boolean(main.querySelector('.note-slider .img-container img'));
  const videos = Array.from(main.querySelectorAll('video'));
  const hasLivePhoto = videos.some(video => video.closest('.live-photo-contain, .live-video-wrapper'));
  const standaloneVideo = videos.some(video => !video.closest('.live-photo-contain, .live-video-wrapper'));
  return {
    type: imageCarousel && !standaloneVideo ? 'image' : standaloneVideo && !imageCarousel ? 'video' : 'unknown',
    has_live_photo: hasLivePhoto,
  };
}
