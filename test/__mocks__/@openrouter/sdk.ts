/** Mock for @openrouter/sdk */

export const OpenRouter = jest.fn().mockImplementation(() => ({
  chat: {
    send: jest.fn(),
  },
}));
