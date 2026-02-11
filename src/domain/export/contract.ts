export const EXPORT_CONTRACT = {
  envelopeProfileKey: "profile",
  envelopeAuthorKey: "author",
  envelopePostsKey: "posts",
  removePostKeys: {
    storyId: true,
    profile: true,
    avatar: true,
    url: true,
    author: true,
    feedbackId: true,
    reactionsCount: true,
    shareCount: true,
    commentCount: true,
    commentsCount: true
  } as Record<string, true>
};
