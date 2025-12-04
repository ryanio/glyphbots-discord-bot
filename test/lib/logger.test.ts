import { isDebugEnabled, logger, prefixedLogger } from "../../src/lib/logger";

describe("logger", () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation();
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe("logger methods", () => {
    it("should have info method", () => {
      expect(typeof logger.info).toBe("function");
    });

    it("should have debug method", () => {
      expect(typeof logger.debug).toBe("function");
    });

    it("should have warn method", () => {
      expect(typeof logger.warn).toBe("function");
    });

    it("should have error method", () => {
      expect(typeof logger.error).toBe("function");
    });

    it("should write info to stdout", () => {
      logger.info("test message");
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.at(0)?.at(0) as string;
      expect(output).toContain("[INFO]");
      expect(output).toContain("test message");
      expect(output).toContain("[GlyphBots]");
    });

    it("should write warn to stderr", () => {
      logger.warn("warning message");
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.at(0)?.at(0) as string;
      expect(output).toContain("[WARN]");
      expect(output).toContain("warning message");
    });

    it("should write error to stderr", () => {
      logger.error("error message");
      expect(stderrSpy).toHaveBeenCalled();
      const output = stderrSpy.mock.calls.at(0)?.at(0) as string;
      expect(output).toContain("[ERROR]");
      expect(output).toContain("error message");
    });

    it("should serialize objects", () => {
      logger.info({ key: "value" });
      const output = stdoutSpy.mock.calls.at(0)?.at(0) as string;
      expect(output).toContain('{"key":"value"}');
    });

    it("should handle multiple arguments", () => {
      logger.info("message", "arg1", "arg2");
      const output = stdoutSpy.mock.calls.at(0)?.at(0) as string;
      expect(output).toContain("message");
      expect(output).toContain("arg1");
      expect(output).toContain("arg2");
    });
  });

  describe("prefixedLogger", () => {
    it("should add prefix to log messages", () => {
      const log = prefixedLogger("TestPrefix");
      log.info("prefixed message");

      const output = stdoutSpy.mock.calls.at(0)?.at(0) as string;
      expect(output).toContain("[TestPrefix]");
      expect(output).toContain("prefixed message");
    });

    it("should have all log methods", () => {
      const log = prefixedLogger("Test");
      expect(typeof log.info).toBe("function");
      expect(typeof log.debug).toBe("function");
      expect(typeof log.warn).toBe("function");
      expect(typeof log.error).toBe("function");
    });
  });

  describe("isDebugEnabled", () => {
    it("should return boolean", () => {
      expect(typeof isDebugEnabled()).toBe("boolean");
    });
  });
});
