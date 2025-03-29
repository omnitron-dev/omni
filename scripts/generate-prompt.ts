import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const SRC_DIR = path.resolve(__dirname, 'src');
const TESTS_DIR = path.resolve(__dirname, 'tests');

export function copyToClipboard(text: string) {
  const platform = os.platform();
  try {
    if (platform === 'linux') {
      execSync(`echo "${text}" | xclip -selection clipboard`);
    } else if (platform === 'darwin') {
      execSync(`echo "${text}" | pbcopy`);
    } else if (platform === 'win32') {
      execSync(`echo "${text}" | clip`);
    }
  } catch (error) {
    console.error('❌ Ошибка при копировании в буфер обмена:', error);
  }
}

// 🔥 Функция для рекурсивного обхода `src/`
function walkDir(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(walkDir(filePath));
    } else {
      results.push(filePath);
    }
  });
  return results;
}

// 🔥 Формируем `ChatGPT`-совместимый промпт
function generatePrompt(): string {
  const files = walkDir(SRC_DIR);
  // const files = walkDir(TESTS_DIR);
  let prompt = `Вот файлы проекта и их содержимое:\n\n`;

  files.forEach((file) => {
    const relativePath = path.relative(SRC_DIR, file);
    const content = fs.readFileSync(file, 'utf8');

    prompt += `### Файл: ${relativePath}\n`;
    prompt += '```\n';
    prompt += content;
    prompt += '\n```\n\n';
  });

  return prompt;
}

const OUTPUT_FILE = path.resolve(__dirname, 'prompt.txt');

function savePromptToFile() {
  const prompt = generatePrompt();
  fs.writeFileSync(OUTPUT_FILE, prompt);
  console.log(`✅ Промпт сохранён в ${OUTPUT_FILE}`);
}

// Запускаем скрипт
savePromptToFile();
