export const EXPORT_CONTRACT = {
    envelopeAuthorKey: 'author',
    envelopePostsKey: 'posts',
    envelopeProfileKey: 'profile',
    removePostKeys: {
        author: true,
        avatar: true,
        commentCount: true,
        commentsCount: true,
        feedbackId: true,
        profile: true,
        reactionsCount: true,
        shareCount: true,
        storyId: true,
        url: true,
    } as Record<string, true>,
};
