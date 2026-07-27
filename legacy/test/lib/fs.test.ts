import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirectory, readFileText, writeFileText } from "../../src/lib/fs";

jest.mock("node:fs/promises");

const mockedMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

describe("fs", () => {
  const testDir = join(tmpdir(), "glyphbots-test");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("readFileText", () => {
    it("should read file as UTF-8 text", async () => {
      const filePath = join(testDir, "test.txt");
      const content = "test content";

      mockedReadFile.mockResolvedValue(content as never);

      const result = await readFileText(filePath);

      expect(result).toBe(content);
      expect(mockedReadFile).toHaveBeenCalledWith(filePath, "utf8");
      expect(mockedReadFile).toHaveBeenCalledTimes(1);
    });

    it("should throw error when file cannot be read", async () => {
      const filePath = join(testDir, "missing.txt");
      const error = new Error("ENOENT: no such file or directory");

      mockedReadFile.mockRejectedValue(error);

      await expect(readFileText(filePath)).rejects.toThrow(error);
      expect(mockedReadFile).toHaveBeenCalledWith(filePath, "utf8");
    });

    it("should handle empty files", async () => {
      const filePath = join(testDir, "empty.txt");

      mockedReadFile.mockResolvedValue("" as never);

      const result = await readFileText(filePath);

      expect(result).toBe("");
      expect(mockedReadFile).toHaveBeenCalledWith(filePath, "utf8");
    });

    it("should handle files with special characters", async () => {
      const filePath = join(testDir, "special.txt");
      const content = "test content with émojis 🎉 and unicode 中文";

      mockedReadFile.mockResolvedValue(content as never);

      const result = await readFileText(filePath);

      expect(result).toBe(content);
      expect(mockedReadFile).toHaveBeenCalledWith(filePath, "utf8");
    });
  });

  describe("writeFileText", () => {
    it("should write text to file with default UTF-8 encoding", async () => {
      const filePath = join(testDir, "output.txt");
      const content = "test content";

      mockedWriteFile.mockResolvedValue(undefined);

      await writeFileText(filePath, content);

      expect(mockedWriteFile).toHaveBeenCalledWith(filePath, content, "utf8");
      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    });

    it("should write text with custom encoding", async () => {
      const filePath = join(testDir, "output.txt");
      const content = "test content";

      mockedWriteFile.mockResolvedValue(undefined);

      await writeFileText(filePath, content, "ascii");

      expect(mockedWriteFile).toHaveBeenCalledWith(filePath, content, "ascii");
    });

    it("should throw error when file cannot be written", async () => {
      const filePath = join(testDir, "readonly.txt");
      const content = "test content";
      const error = new Error("EACCES: permission denied");

      mockedWriteFile.mockRejectedValue(error);

      await expect(writeFileText(filePath, content)).rejects.toThrow(error);
      expect(mockedWriteFile).toHaveBeenCalledWith(filePath, content, "utf8");
    });

    it("should handle empty content", async () => {
      const filePath = join(testDir, "empty.txt");

      mockedWriteFile.mockResolvedValue(undefined);

      await writeFileText(filePath, "");

      expect(mockedWriteFile).toHaveBeenCalledWith(filePath, "", "utf8");
    });

    it("should handle content with special characters", async () => {
      const filePath = join(testDir, "special.txt");
      const content = "test content with émojis 🎉 and unicode 中文";

      mockedWriteFile.mockResolvedValue(undefined);

      await writeFileText(filePath, content);

      expect(mockedWriteFile).toHaveBeenCalledWith(filePath, content, "utf8");
    });
  });

  describe("ensureDirectory", () => {
    it("should create directory with default recursive option", async () => {
      const dirPath = join(testDir, "nested", "path");

      mockedMkdir.mockResolvedValue(undefined);

      await ensureDirectory(dirPath);

      expect(mockedMkdir).toHaveBeenCalledWith(dirPath, { recursive: true });
      expect(mockedMkdir).toHaveBeenCalledTimes(1);
    });

    it("should create directory with custom options", async () => {
      const dirPath = join(testDir, "custom");
      const options = { recursive: false, mode: 0o755 };

      mockedMkdir.mockResolvedValue(undefined);

      await ensureDirectory(dirPath, options);

      expect(mockedMkdir).toHaveBeenCalledWith(dirPath, options);
    });

    it("should return directory path when mkdir returns string", async () => {
      const dirPath = join(testDir, "returns-path");

      mockedMkdir.mockResolvedValue(dirPath);

      const result = await ensureDirectory(dirPath);

      expect(result).toBe(dirPath);
      expect(mockedMkdir).toHaveBeenCalledWith(dirPath, { recursive: true });
    });

    it("should throw error when directory cannot be created", async () => {
      const dirPath = join(testDir, "error");
      const error = new Error("EACCES: permission denied");

      mockedMkdir.mockRejectedValue(error);

      await expect(ensureDirectory(dirPath)).rejects.toThrow(error);
      expect(mockedMkdir).toHaveBeenCalledWith(dirPath, { recursive: true });
    });

    it("should handle existing directory gracefully with recursive option", async () => {
      const dirPath = join(testDir, "exists");

      mockedMkdir.mockResolvedValue(undefined);

      await ensureDirectory(dirPath);

      expect(mockedMkdir).toHaveBeenCalledWith(dirPath, { recursive: true });
    });
  });
});
