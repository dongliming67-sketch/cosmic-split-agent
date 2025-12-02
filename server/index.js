const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 文件上传配置 - 支持更多格式
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // 解码文件名（处理中文文件名）
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc (旧格式)
      'text/plain', // .txt
      'text/markdown', // .md
    ];
    
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.docx', '.doc', '.txt', '.md'];
    
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，请上传 .docx, .txt 或 .md 文件`));
    }
  }
});

// 错误处理中间件
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超过限制（最大50MB）' });
    }
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// OpenAI客户端
let openai = null;

function getOpenAIClient() {
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    });
  }
  return openai;
}

// Cosmic拆分系统提示词
const COSMIC_SYSTEM_PROMPT = `你是一个Cosmic拆分专家。你的任务是将功能过程按照COSMIC规则拆分，并输出真实、具体、可落地的功能过程，功能过程的组成要是动词+名词。

- E (Entry): 输入，触发请求
- R (Read): 读取数据库
- W (Write): 写入数据库
- X (eXit): 输出结果

## 【最重要】功能过程与子功能过程的关系（必须严格遵守）
**一个功能过程必须包含多个子功能过程（子过程），这是层级关系，不是并列关系！**

### 正确示例（一个功能过程对应4个子过程）：
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|用户触发|用户请求|删除设备孪生体|接收删除请求|E|删除请求参数|孪生体ID、删除理由、删除人|
||||读取孪生体信息|R|设备孪生体详情表|孪生体ID、设备名称、创建时间|
||||删除孪生体记录|W|设备孪生体删除数据|孪生体ID、删除时间、删除人|
||||返回删除结果|X|删除结果响应|孪生体ID、状态、消息、删除时间|

### 错误示例（绝对禁止！每行都写功能过程名称）：
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|...|
|用户触发|用户请求|删除设备孪生体|删除指定的设备孪生体|E|...|
|用户触发|系统读取|查询指定孪生体信息|读取指定孪生体的详细信息|R|...|  ← 错误！这应该是上面功能过程的子过程
|用户触发|系统写入|删除孪生体记录|将指定孪生体的记录从数据库中删除|W|...| ← 错误！
|用户触发|系统输出|返回删除结果|显示孪生体删除成功信息|X|...| ← 错误！

## 核心规则
1. **一个功能过程 = 1个E + 1-3个R/W + 1个X**，共3-5个子过程
2. **功能过程名称只在第一行（E行）填写**，后续子过程行的功能过程列必须留空
3. **顺序必须是：E开头 → 中间R/W → X结尾**
4. 功能过程名称必须是"动词+名词"形式（如"删除设备孪生体"、"查询告警记录"）
5. 子过程描述必须是具体动作（如"接收删除请求"、"读取设备信息"、"写入操作日志"、"返回处理结果"）

## 数据组和数据属性要求
- 每个子过程必须填写数据组和数据属性
- 数据组命名需结合当前功能/子过程，禁止出现连字符 "-"
- 数据属性至少3个字段，同一功能过程中不允许与其他子过程完全相同

## 功能用户填写
- 用户触发：发起者：用户 接收者：用户（或简写为"用户触发"）
- 时钟触发：发起者：定时触发器 接收者：网优平台
- 接口触发：发起者：其他平台 接收者：网优平台

## 完整输出格式示例（注意功能过程列的合并效果）

|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|:---|:---|:---|:---|:---|:---|:---|
|用户触发|用户请求|创建设备维护计划|初始化维护计划参数|E|设备维护计划触发参数|设备ID、维护周期、维护类型、优先级|
||||获取设备当前状态|R|设备状态信息集|设备ID、设备型号、当前运行状态、上次维护时间|
||||计算维护任务|W|维护任务信息集|任务ID、执行时间、维护内容、责任人|
||||显示维护计划结果|X|设备维护计划结果展示集|维护计划ID、执行时间、维护内容、责任人|
|用户触发|用户请求|更新设备配置|初始化配置更新参数|E|设备配置更新触发参数|设备ID、配置项、新配置值、更新原因|
||||读取当前配置状态|R|设备配置更新当前配置信息集|配置项、配置值、配置时间、配置人|
||||更新配置信息|W|设备配置更新信息集|配置项、新值、更新时间、更新人|
||||显示配置更新结果|X|设备配置更新结果展示集|配置项、新值、更新时间、更新人|

请严格按照上述格式输出，确保每个功能过程包含3-5个子过程，功能过程名称只在E行填写！`;

// API路由

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasApiKey: !!process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  });
});

// 更新API配置
app.post('/api/config', (req, res) => {
  const { apiKey, baseUrl } = req.body;
  
  if (apiKey) {
    process.env.OPENAI_API_KEY = apiKey;
  }
  if (baseUrl) {
    process.env.OPENAI_BASE_URL = baseUrl;
  }
  
  // 重置客户端以使用新配置
  openai = null;
  
  res.json({ success: true, message: 'API配置已更新' });
});

// 解析文档（支持多种格式）
app.post('/api/parse-word', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';
    let html = '';

    console.log(`解析文件: ${req.file.originalname}, 类型: ${req.file.mimetype}, 大小: ${req.file.size} bytes`);

    if (ext === '.docx') {
      // 解析 .docx 文件
      try {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = result.value;
        
        const htmlResult = await mammoth.convertToHtml({ buffer: req.file.buffer });
        html = htmlResult.value;
        
        if (result.messages && result.messages.length > 0) {
          console.log('Mammoth警告:', result.messages);
        }
      } catch (mammothError) {
        console.error('Mammoth解析错误:', mammothError);
        return res.status(400).json({ 
          error: `Word文档解析失败: ${mammothError.message}。请确保文件是有效的.docx格式（不支持旧版.doc格式）` 
        });
      }
    } else if (ext === '.txt' || ext === '.md') {
      // 解析纯文本或Markdown文件
      text = req.file.buffer.toString('utf-8');
      html = `<pre>${text}</pre>`;
    } else if (ext === '.doc') {
      return res.status(400).json({ 
        error: '不支持旧版.doc格式，请将文件另存为.docx格式后重新上传' 
      });
    } else {
      return res.status(400).json({ error: `不支持的文件格式: ${ext}` });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: '文档内容为空，请检查文件是否正确' });
    }

    res.json({ 
      success: true, 
      text: text,
      html: html,
      filename: req.file.originalname,
      fileSize: req.file.size,
      wordCount: text.length
    });
  } catch (error) {
    console.error('解析文档失败:', error);
    res.status(500).json({ error: '解析文档失败: ' + error.message });
  }
});

// AI对话 - Cosmic拆分
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, documentContent } = req.body;
    
    const client = getOpenAIClient();
    if (!client) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    // 构建消息
    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    const chatMessages = [systemMessage];
    
    // 如果有文档内容，添加到上下文
    if (documentContent) {
      chatMessages.push({
        role: 'user',
        content: `以下是需要进行Cosmic拆分的功能过程文档内容：\n\n${documentContent}\n\n请根据上述内容进行Cosmic拆分。`
      });
    }

    // 添加用户消息历史
    if (messages && messages.length > 0) {
      chatMessages.push(...messages);
    }

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 8000
    });

    const reply = completion.choices[0].message.content;

    res.json({ 
      success: true, 
      reply: reply,
      usage: completion.usage
    });
  } catch (error) {
    console.error('AI对话失败:', error);
    res.status(500).json({ error: 'AI对话失败: ' + error.message });
  }
});

// 流式AI对话
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { messages, documentContent } = req.body;
    
    console.log('收到流式对话请求，文档长度:', documentContent?.length || 0);
    
    const client = getOpenAIClient();
    if (!client) {
      console.error('API客户端未初始化');
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ error: '请先配置API密钥' })}\n\n`);
      res.end();
      return;
    }

    // 设置SSE响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    const chatMessages = [systemMessage];
    
    if (documentContent) {
      chatMessages.push({
        role: 'user',
        content: `以下是需要进行Cosmic拆分的功能过程文档内容：\n\n${documentContent}\n\n请根据上述内容进行Cosmic拆分，生成标准的Markdown表格。`
      });
    }

    if (messages && messages.length > 0) {
      chatMessages.push(...messages);
    }

    console.log('调用AI API，模型:', process.env.OPENAI_MODEL || 'glm-4-flash');
    console.log('消息数量:', chatMessages.length);

    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 8000,
      stream: true
    });

    let totalContent = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        totalContent += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    console.log('AI响应完成，总长度:', totalContent.length);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('流式对话失败:', error.message);
    console.error('错误详情:', error);
    
    // 确保响应头已设置
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
    }
    res.write(`data: ${JSON.stringify({ error: '调用AI失败: ' + error.message })}\n\n`);
    res.end();
  }
});

// 循环调用 - 继续生成直到完成所有功能过程
app.post('/api/continue-analyze', async (req, res) => {
  try {
    const { documentContent, previousResults = [], round = 1, targetFunctions = 30 } = req.body;
    
    const client = getOpenAIClient();
    if (!client) {
      return res.status(400).json({ error: '请先配置API密钥' });
    }

    // 构建已完成的功能过程列表
    const completedFunctions = previousResults.map(r => r.functionalProcess).filter(Boolean);
    const uniqueCompleted = [...new Set(completedFunctions)];
    
    let userPrompt = '';
    if (round === 1) {
      userPrompt = `以下是功能文档内容：

${documentContent}

请对文档中的功能进行COSMIC拆分，输出Markdown表格。

【最重要规则 - 功能过程与子过程的层级关系】：
**一个功能过程必须包含多个子过程，功能过程名称只在第一行（E行）填写，后续子过程行的功能过程列必须留空！**

正确示例（功能过程名称只出现一次）：
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|数据组|数据属性|
|用户触发|用户请求|处理安全事件|接收事件请求|E|事件请求参数|事件ID、事件类型、触发时间|
||||读取事件详情|R|安全事件表|事件ID、事件级别、发生时间|
||||写入处理记录|W|事件处理表|处理ID、处理人、处理结果|
||||返回处理结果|X|事件响应数据|事件ID、处理状态、完成时间|

错误示例（绝对禁止！每行都写功能过程名称）：
|用户触发|用户请求|处理安全事件|接收事件请求|E|...|
|用户触发|系统读取|读取事件详情|读取事件信息|R|...| ← 错误！这应该是子过程，功能过程列应为空
|用户触发|系统写入|写入处理记录|写入记录|W|...| ← 错误！

【功能过程命名规则 - 必须唯一且细致】：
1. **每个功能过程名称必须唯一，绝对不能重复！**
2. 功能过程名称要具体、细致，体现具体的业务场景
3. 避免使用过于笼统的名称，如"数据管理"、"信息处理"
4. 正确命名示例：
   - "创建设备孪生体" vs "更新设备孪生体" vs "删除设备孪生体"（细分操作类型）
   - "查询实时飞行轨迹" vs "查询历史飞行轨迹"（细分时间维度）
   - "审批普通任务" vs "审批紧急任务"（细分业务场景）

【其他规则】：
1. 每个功能过程 = 1个E + 1-3个R/W + 1个X，共3-5个子过程
2. 顺序必须是：E开头 → 中间R/W → X结尾
3. 尽可能多地识别功能过程，至少识别 ${targetFunctions} 个功能过程`;
    } else {
      userPrompt = `继续分析文档中尚未拆分的功能过程。

已完成的功能过程（${uniqueCompleted.length}个）：
${uniqueCompleted.slice(0, 30).join('、')}${uniqueCompleted.length > 30 ? '...' : ''}

目标是最终至少覆盖 ${targetFunctions} 个功能过程。

【最重要规则 - 功能过程与子过程的层级关系】：
**一个功能过程必须包含多个子过程，功能过程名称只在第一行（E行）填写，后续子过程行的功能过程列必须留空！**

正确格式：
|功能用户|触发事件|功能过程|子过程描述|数据移动类型|...|
|用户触发|用户请求|XXX功能|接收请求|E|...|
||||读取数据|R|...|  ← 功能过程列为空
||||写入数据|W|...|  ← 功能过程列为空
||||返回结果|X|...|  ← 功能过程列为空

【功能过程命名规则 - 必须唯一且细致】：
1. **绝对不能与上面已完成的功能过程重复！**
2. 功能过程名称要具体、细致，体现具体的业务场景
3. 可以从以下维度细分：
   - 操作类型：创建/查询/更新/删除/审批/导出
   - 时间维度：实时/历史/定时/周期
   - 业务场景：普通/紧急/批量/单个
   - 对象类型：设备/用户/任务/告警/日志

请继续拆分文档中【其他尚未处理的功能】，输出Markdown表格格式。
如果所有功能都已拆分完成，请回复"[ALL_DONE]"。`;
    }

    const systemMessage = {
      role: 'system',
      content: COSMIC_SYSTEM_PROMPT
    };

    console.log(`第 ${round} 轮分析开始，已完成 ${uniqueCompleted.length} 个功能过程...`);

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: [
        systemMessage,
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 8000
    });

    const reply = completion.choices[0].message.content;
    console.log(`第 ${round} 轮完成，响应长度: ${reply.length}`);

    // 检查是否完成
    const isDone = reply.includes('[ALL_DONE]') || reply.includes('已完成') || reply.includes('全部拆分');

    res.json({ 
      success: true, 
      reply: reply,
      round: round,
      isDone: isDone,
      completedFunctions: uniqueCompleted.length,
      targetFunctions
    });
  } catch (error) {
    console.error('分析失败:', error);
    res.status(500).json({ error: '分析失败: ' + error.message });
  }
});

// 导出Excel
app.post('/api/export-excel', async (req, res) => {
  try {
    const { tableData, filename } = req.body;
    
    if (!tableData || !Array.isArray(tableData) || tableData.length === 0) {
      return res.status(400).json({ error: '无有效数据可导出' });
    }

    // ========== 预处理：自动填充空白格 ==========
    // 将功能用户、触发事件、功能过程向下填充到空白行
    const filledTableData = fillEmptyCells(tableData);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cosmic拆分结果');

    // 设置列
    worksheet.columns = [
      { header: '功能用户', key: 'functionalUser', width: 25 },
      { header: '触发事件', key: 'triggerEvent', width: 15 },
      { header: '功能过程', key: 'functionalProcess', width: 30 },
      { header: '子过程描述', key: 'subProcessDesc', width: 35 },
      { header: '数据移动类型', key: 'dataMovementType', width: 15 },
      { header: '数据组', key: 'dataGroup', width: 25 },
      { header: '数据属性', key: 'dataAttributes', width: 50 }
    ];

    // 设置表头样式
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    // 添加数据
    filledTableData.forEach((row, index) => {
      const dataRow = worksheet.addRow({
        functionalUser: row.functionalUser || '',
        triggerEvent: row.triggerEvent || '',
        functionalProcess: row.functionalProcess || '',
        subProcessDesc: row.subProcessDesc || '',
        dataMovementType: row.dataMovementType || '',
        dataGroup: row.dataGroup || '',
        dataAttributes: row.dataAttributes || ''
      });

      // 交替行颜色
      if (index % 2 === 1) {
        dataRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
      }

      dataRow.alignment = { vertical: 'middle', wrapText: true };
    });

    // 添加边框
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // 生成文件
    const buffer = await workbook.xlsx.writeBuffer();
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'cosmic_result')}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('导出Excel失败:', error);
    res.status(500).json({ error: '导出Excel失败: ' + error.message });
  }
});

// ========== 自动填充空白格函数 ==========
// 将功能用户、触发事件、功能过程向下填充到空白行（像Excel合并单元格的效果）
function fillEmptyCells(tableData) {
  if (!tableData || tableData.length === 0) return tableData;
  
  const result = [];
  let lastFunctionalUser = '';
  let lastTriggerEvent = '';
  let lastFunctionalProcess = '';
  
  for (let i = 0; i < tableData.length; i++) {
    const row = { ...tableData[i] };
    
    // 如果当前行有功能用户，更新记录；否则使用上一个有效值
    if (row.functionalUser && row.functionalUser.trim()) {
      lastFunctionalUser = row.functionalUser.trim();
    } else {
      row.functionalUser = lastFunctionalUser;
    }
    
    // 如果当前行有触发事件，更新记录；否则使用上一个有效值
    if (row.triggerEvent && row.triggerEvent.trim()) {
      lastTriggerEvent = row.triggerEvent.trim();
    } else {
      row.triggerEvent = lastTriggerEvent;
    }
    
    // 如果当前行有功能过程，更新记录；否则使用上一个有效值
    if (row.functionalProcess && row.functionalProcess.trim()) {
      lastFunctionalProcess = row.functionalProcess.trim();
    } else {
      row.functionalProcess = lastFunctionalProcess;
    }
    
    result.push(row);
  }
  
  console.log(`自动填充完成: ${result.length} 行数据`);
  return result;
}

// AI智能去重 - 分析前面数据组内容，结合子过程关键字生成新名称
// 例如："用户信息" 重复时，根据子过程"删除用户"生成 "用户信息删除表"
async function aiGenerateUniqueName(originalName, subProcessDesc, functionalProcess, existingNames) {
  const client = getOpenAIClient();
  if (!client) {
    // 如果没有API，使用本地提取方式
    return generateUniqueNameLocal(originalName, subProcessDesc);
  }

  try {
    const prompt = `你是一个数据命名专家。现在有一个数据组/数据属性名称"${originalName}"与已有名称重复。

上下文信息：
- 功能过程：${functionalProcess}
- 子过程描述：${subProcessDesc}
- 已存在的类似名称：${existingNames.slice(0, 5).join(', ')}

请根据子过程描述的业务含义，直接生成一个新的完整名称，将原名称与子过程的关键动作/对象结合。

要求：
1. 不要使用括号，直接将关键词融入名称
2. 新名称要体现子过程的具体业务动作
3. 只输出新名称本身，不要其他解释
4. 名称要简洁，不超过15个字

示例：
- 原名称"用户信息"，子过程"删除用户记录" -> 用户信息删除表
- 原名称"设备数据"，子过程"读取设备状态" -> 设备状态读取数据
- 原名称"告警记录"，子过程"写入告警处理结果" -> 告警处理结果记录
- 原名称"订单信息"，子过程"查询历史订单" -> 历史订单查询信息`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 50
    });

    const newName = completion.choices[0].message.content.trim();
    // 清理可能的多余内容
    const cleanName = newName.replace(/["'\n\r]/g, '').slice(0, 20);
    return cleanName || generateUniqueNameLocal(originalName, subProcessDesc);
  } catch (error) {
    console.log('AI生成名称失败，使用本地提取:', error.message);
    return generateUniqueNameLocal(originalName, subProcessDesc);
  }
}

// 本地名称生成（备用方案）- 将原名称与子过程关键词结合（用于数据组）
function generateUniqueNameLocal(originalName, subProcessDesc = '') {
  // 从子过程描述中提取关键动词和名词
  const cleaned = subProcessDesc
    .replace(/[\d]/g, '')
    .replace(/[，。、《》（）()？：；\-·]/g, ' ')
    .trim();
  
  if (!cleaned) {
    return originalName + '扩展表';
  }
  
  // 常见动词列表
  const actionWords = ['查询', '读取', '写入', '删除', '更新', '新增', '修改', '获取', '提交', '保存', '导出', '导入', '分析', '统计', '处理', '审核', '验证', '确认'];
  
  // 提取动词
  let action = '';
  for (const word of actionWords) {
    if (cleaned.includes(word)) {
      action = word;
      break;
    }
  }
  
  // 提取名词（去掉动词后的内容）
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const noun = tokens.find(t => t.length >= 2 && !actionWords.includes(t)) || '';
  
  // 组合新名称
  if (action && noun) {
    return originalName + action + noun;
  } else if (action) {
    return originalName + action + '表';
  } else if (noun) {
    return originalName + noun + '表';
  } else {
    // 直接取子过程描述的前几个字
    const prefix = tokens.slice(0, 2).map(t => t.slice(0, 3)).join('');
    return originalName + (prefix || '扩展') + '表';
  }
}

// AI智能去重 - 专门用于数据属性，使用更多字段组合
async function aiGenerateUniqueAttrName(originalName, subProcessDesc, functionalProcess, existingNames, dataGroup) {
  const client = getOpenAIClient();
  if (!client) {
    return generateUniqueAttrNameLocal(originalName, subProcessDesc, dataGroup);
  }

  try {
    const prompt = `你是一个数据属性命名专家。现在有一个数据属性名称"${originalName}"与已有名称重复。

上下文信息：
- 功能过程：${functionalProcess}
- 子过程描述：${subProcessDesc}
- 所属数据组：${dataGroup}
- 已存在的类似名称：${existingNames.slice(0, 5).join(', ')}

请根据上下文信息，生成一个新的数据属性名称。

要求：
1. 不要使用括号，直接将关键词融入名称
2. 新名称要体现数据属性的具体特征（如ID、类型、参数、版本、状态等）
3. 可以结合数据组名称、子过程动作来区分
4. 只输出新名称本身，不要其他解释
5. 名称要简洁，不超过15个字

示例：
- 原名称"模型ID"，子过程"查询模型信息"，数据组"模型数据" -> 查询模型标识
- 原名称"设备类型"，子过程"更新设备状态"，数据组"设备信息" -> 设备状态类型
- 原名称"模型数据"，子过程"读取模型版本"，数据组"模型信息" -> 模型版本数据
- 原名称"设备参数"，子过程"导出设备配置"，数据组"设备导出" -> 导出配置参数`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 50
    });

    const newName = completion.choices[0].message.content.trim();
    const cleanName = newName.replace(/["'\n\r]/g, '').slice(0, 20);
    return cleanName || generateUniqueAttrNameLocal(originalName, subProcessDesc, dataGroup);
  } catch (error) {
    console.log('AI生成属性名称失败，使用本地提取:', error.message);
    return generateUniqueAttrNameLocal(originalName, subProcessDesc, dataGroup);
  }
}

// 本地属性名称生成（备用方案）- 使用更多字段组合
function generateUniqueAttrNameLocal(originalName, subProcessDesc = '', dataGroup = '') {
  const cleaned = subProcessDesc
    .replace(/[\d]/g, '')
    .replace(/[，。、《》（）()？：；\-·]/g, ' ')
    .trim();
  
  // 属性相关的后缀词
  const attrSuffixes = ['标识', '编号', '类型', '参数', '版本', '状态', '配置', '属性', '字段', '值'];
  // 常见动词列表
  const actionWords = ['查询', '读取', '写入', '删除', '更新', '新增', '修改', '获取', '提交', '保存', '导出', '导入', '分析', '统计', '处理', '审核', '验证', '确认'];
  
  // 提取动词
  let action = '';
  for (const word of actionWords) {
    if (cleaned.includes(word)) {
      action = word;
      break;
    }
  }
  
  // 从数据组中提取关键词
  const groupKeyword = dataGroup.replace(/[数据表信息记录]/g, '').slice(0, 4);
  
  // 随机选择一个属性后缀
  const randomSuffix = attrSuffixes[Math.floor(Math.random() * attrSuffixes.length)];
  
  // 组合新名称 - 使用不同于数据组的组合方式
  if (action && groupKeyword) {
    return action + groupKeyword + randomSuffix;
  } else if (action) {
    return action + originalName + randomSuffix;
  } else if (groupKeyword) {
    return groupKeyword + originalName.slice(0, 4) + randomSuffix;
  } else {
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const prefix = tokens.slice(0, 2).map(t => t.slice(0, 2)).join('');
    return (prefix || '扩展') + originalName + randomSuffix;
  }
}

// ========== 功能过程去重函数 ==========
// 删除重复的功能过程及其下的所有子过程
function removeDuplicateFunctionalProcesses(tableData) {
  if (!tableData || tableData.length === 0) return tableData;
  
  const seenProcesses = new Set(); // 已出现的功能过程名称
  const result = [];
  let currentProcess = ''; // 当前正在处理的功能过程
  let skipCurrentProcess = false; // 是否跳过当前功能过程
  
  for (let i = 0; i < tableData.length; i++) {
    const row = tableData[i];
    
    // 获取当前行的功能过程（可能为空，需要继承）
    const rowProcess = (row.functionalProcess || '').trim();
    const parentProcess = (row._parentProcess || '').trim();
    const effectiveProcess = rowProcess || parentProcess || currentProcess;
    
    // 如果是E类型（入口），说明是新功能过程的开始
    if (row.dataMovementType === 'E' && rowProcess) {
      currentProcess = rowProcess;
      
      // 检查是否重复
      const processKey = rowProcess.toLowerCase();
      if (seenProcesses.has(processKey)) {
        console.log(`发现重复功能过程: "${rowProcess}"，跳过该功能过程的所有子过程`);
        skipCurrentProcess = true;
        continue; // 跳过这一行
      } else {
        seenProcesses.add(processKey);
        skipCurrentProcess = false;
      }
    }
    
    // 如果当前功能过程被标记为跳过，则跳过该行
    if (skipCurrentProcess) {
      // 检查是否进入了新的功能过程（通过E类型判断）
      if (row.dataMovementType === 'E' && rowProcess && rowProcess !== currentProcess) {
        // 新功能过程开始，重新检查
        currentProcess = rowProcess;
        const processKey = rowProcess.toLowerCase();
        if (seenProcesses.has(processKey)) {
          console.log(`发现重复功能过程: "${rowProcess}"，跳过该功能过程的所有子过程`);
          skipCurrentProcess = true;
          continue;
        } else {
          seenProcesses.add(processKey);
          skipCurrentProcess = false;
        }
      } else {
        continue; // 继续跳过
      }
    }
    
    result.push(row);
  }
  
  console.log(`功能过程去重: 原 ${tableData.length} 条 -> 现 ${result.length} 条，共 ${seenProcesses.size} 个唯一功能过程`);
  return result;
}

// ========== 最终系统性去重函数 ==========
// 对整个表格数据进行最终检查，确保数据组和数据属性没有完全重复
async function performFinalDeduplication(tableData) {
  if (!tableData || tableData.length === 0) return tableData;

  console.log('========== 开始最终系统性去重检查 ==========');
  
  // ========== 第零步：功能过程去重 ==========
  // 如果功能过程重复，删除重复功能过程的整组数据（包括其下的所有子过程）
  tableData = removeDuplicateFunctionalProcesses(tableData);
  console.log(`功能过程去重后剩余 ${tableData.length} 条数据`);
  
  const result = [];
  const seenDataGroups = new Map(); // key: 数据组名称(小写), value: { count, indices }
  const seenDataAttrs = new Map();  // key: 数据属性名称(小写), value: { count, indices }
  
  // 第一遍：收集所有重复项
  tableData.forEach((row, idx) => {
    const groupKey = (row.dataGroup || '').toLowerCase().trim();
    const attrKey = (row.dataAttributes || '').toLowerCase().trim();
    
    if (groupKey) {
      if (!seenDataGroups.has(groupKey)) {
        seenDataGroups.set(groupKey, { count: 0, indices: [], original: row.dataGroup });
      }
      const entry = seenDataGroups.get(groupKey);
      entry.count++;
      entry.indices.push(idx);
    }
    
    if (attrKey) {
      if (!seenDataAttrs.has(attrKey)) {
        seenDataAttrs.set(attrKey, { count: 0, indices: [], original: row.dataAttributes });
      }
      const entry = seenDataAttrs.get(attrKey);
      entry.count++;
      entry.indices.push(idx);
    }
  });
  
  // 找出重复的数据组和数据属性
  const duplicateGroups = Array.from(seenDataGroups.entries()).filter(([_, v]) => v.count > 1);
  const duplicateAttrs = Array.from(seenDataAttrs.entries()).filter(([_, v]) => v.count > 1);
  
  console.log(`发现 ${duplicateGroups.length} 个重复数据组，${duplicateAttrs.length} 个重复数据属性`);
  
  // 第二遍：处理重复项，为每个重复项生成唯一名称
  const processedGroups = new Set(); // 已处理的数据组索引
  const processedAttrs = new Set();  // 已处理的数据属性索引
  
  for (let i = 0; i < tableData.length; i++) {
    const row = { ...tableData[i] };
    const groupKey = (row.dataGroup || '').toLowerCase().trim();
    const attrKey = (row.dataAttributes || '').toLowerCase().trim();
    
    // 处理重复的数据组
    if (groupKey && seenDataGroups.has(groupKey)) {
      const entry = seenDataGroups.get(groupKey);
      if (entry.count > 1) {
        const positionInDuplicates = entry.indices.indexOf(i);
        if (positionInDuplicates > 0) { // 第一个保持不变，后续的需要修改
          // 生成唯一名称
          const existingNames = result.map(r => r.dataGroup).filter(Boolean);
          const newName = await generateUniqueGroupName(
            row.dataGroup, 
            row.subProcessDesc, 
            row._parentProcess || row.functionalProcess || '',
            existingNames,
            positionInDuplicates
          );
          console.log(`数据组去重[${i}]: "${row.dataGroup}" -> "${newName}"`);
          row.dataGroup = newName;
        }
      }
    }
    
    // 处理重复的数据属性
    if (attrKey && seenDataAttrs.has(attrKey)) {
      const entry = seenDataAttrs.get(attrKey);
      if (entry.count > 1) {
        const positionInDuplicates = entry.indices.indexOf(i);
        if (positionInDuplicates > 0) { // 第一个保持不变，后续的需要修改
          // 生成唯一属性
          const existingAttrs = result.map(r => r.dataAttributes).filter(Boolean);
          const newAttrs = await generateUniqueAttrString(
            row.dataAttributes,
            row.subProcessDesc,
            row._parentProcess || row.functionalProcess || '',
            existingAttrs,
            row.dataGroup,
            positionInDuplicates
          );
          console.log(`数据属性去重[${i}]: "${row.dataAttributes}" -> "${newAttrs}"`);
          row.dataAttributes = newAttrs;
        }
      }
    }
    
    result.push(row);
  }
  
  console.log('========== 最终去重检查完成 ==========');
  return result;
}

// 生成唯一的数据组名称
async function generateUniqueGroupName(originalName, subProcessDesc, functionalProcess, existingNames, duplicateIndex) {
  // 根据子过程描述提取关键词
  const keywords = extractKeywords(subProcessDesc);
  const actionWord = keywords.action || '';
  const nounWord = keywords.noun || '';
  
  // 尝试不同的组合策略
  const strategies = [
    () => `${originalName}·${actionWord}${nounWord}`.slice(0, 20),
    () => `${actionWord}${originalName}`.slice(0, 20),
    () => `${originalName}${nounWord}表`.slice(0, 20),
    () => `${functionalProcess.slice(0, 4)}${originalName}`.slice(0, 20),
    () => `${originalName}·${duplicateIndex + 1}号`.slice(0, 20)
  ];
  
  for (const strategy of strategies) {
    const candidate = strategy();
    if (candidate && !existingNames.some(n => n.toLowerCase() === candidate.toLowerCase())) {
      return candidate;
    }
  }
  
  // 最后兜底：添加序号
  return `${originalName}·${Date.now() % 1000}`;
}

// 生成唯一的数据属性字符串
async function generateUniqueAttrString(originalAttrs, subProcessDesc, functionalProcess, existingAttrs, dataGroup, duplicateIndex) {
  // 将原有属性拆分成数组
  let fieldsArray = originalAttrs.split(/[|,、，]/).map(f => f.trim()).filter(Boolean);
  
  // 提取关键词
  const keywords = extractKeywords(subProcessDesc);
  const actionWord = keywords.action || '';
  const nounWord = keywords.noun || '';
  const groupKeyword = (dataGroup || '').replace(/[数据表信息记录·]/g, '').slice(0, 4);
  
  // 生成新的字段名
  const newFieldCandidates = [
    `${actionWord}${nounWord}参数`,
    `${groupKeyword}${actionWord}字段`,
    `${functionalProcess.slice(0, 4)}${duplicateIndex + 1}号属性`,
    `${nounWord}状态`,
    `${actionWord}结果`,
    `扩展字段${duplicateIndex + 1}`
  ].filter(f => f && f.length > 2);
  
  // 选择一个不重复的新字段
  for (const candidate of newFieldCandidates) {
    if (!fieldsArray.includes(candidate)) {
      fieldsArray.push(candidate);
      break;
    }
  }
  
  // 打乱顺序
  for (let i = fieldsArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fieldsArray[i], fieldsArray[j]] = [fieldsArray[j], fieldsArray[i]];
  }
  
  return fieldsArray.join(', ');
}

// 从子过程描述中提取关键词
function extractKeywords(subProcessDesc = '') {
  const cleaned = subProcessDesc
    .replace(/[\d]/g, '')
    .replace(/[，。、《》（）()？：；\-·]/g, ' ')
    .trim();
  
  const actionWords = ['查询', '读取', '写入', '删除', '更新', '新增', '修改', '获取', '提交', '保存', '导出', '导入', '分析', '统计', '处理', '审核', '验证', '确认', '接收', '返回', '初始化', '生成', '模拟', '导出'];
  
  let action = '';
  for (const word of actionWords) {
    if (cleaned.includes(word)) {
      action = word;
      break;
    }
  }
  
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const noun = tokens.find(t => t.length >= 2 && !actionWords.includes(t)) || '';
  
  return { action, noun };
}

function ensureMinimumAttributes(attrStr = '', functionalProcess = '', subProcessDesc = '') {
  const fields = Array.from(
    new Set(
      attrStr
        .split(/[|,、，]/)
        .map(f => f.trim())
        .filter(Boolean)
    )
  );

  const candidates = [
    `${functionalProcess || '功能过程'}标识`,
    `${functionalProcess || '功能过程'}编号`,
    `${subProcessDesc || '子过程'}参数`,
    `${subProcessDesc || '子过程'}结果`,
    '记录时间',
    '更新时间',
    '操作人',
    '状态标记'
  ];

  for (const candidate of candidates) {
    if (fields.length >= 3) break;
    if (candidate && !fields.includes(candidate)) {
      fields.push(candidate);
    }
  }

  // 兜底：如果仍然不足3个，使用通用字段
  const fallback = ['记录编号', '业务描述','地市','时间','ID','参数','编号' ,'处理状态'];
  for (const candidate of fallback) {
    if (fields.length >= 3) break;
    if (!fields.includes(candidate)) {
      fields.push(candidate);
    }
  }

  return fields.slice(0, Math.max(fields.length, 3)).join(', ');
}

// 解析Markdown表格为结构化数据
app.post('/api/parse-table', async (req, res) => {
  try {
    const { markdown } = req.body;
    
    if (!markdown) {
      return res.status(400).json({ error: '无Markdown内容' });
    }

    // 提取表格内容
    const tableMatch = markdown.match(/\|[^\n]+\|[\s\S]*?\|[^\n]+\|/g);
    if (!tableMatch) {
      return res.status(400).json({ error: '未找到有效的Markdown表格' });
    }

    const rawLines = markdown.split('\n');
    const lines = rawLines.filter(line => line.trim().startsWith('|'));
    
    if (lines.length < 3) {
      return res.status(400).json({ error: '表格数据不完整' });
    }

    // 跳过表头和分隔行
    const dataLines = lines.slice(2);

    let currentFunctionalUser = '';
    let currentTriggerEvent = '';
    let currentFunctionalProcess = '';
    const pendingRows = [];

    const sanitizeText = (value = '') => value.replace(/-/g, '·').replace(/\s+/g, ' ').trim();

    const normalizeCells = (line) => {
      // 保留所有单元格，包括空的（用于合并单元格）
      const rawCells = line.split('|');
      // 去掉首尾的空字符串（由于 | 开头和结尾产生）
      if (rawCells.length > 0 && rawCells[0].trim() === '') rawCells.shift();
      if (rawCells.length > 0 && rawCells[rawCells.length - 1].trim() === '') rawCells.pop();
      return rawCells.map(cell => cell.trim());
    };

    dataLines.forEach((line, rowIdx) => {
      const cells = normalizeCells(line);
      console.log(`行 ${rowIdx}: cells.length=${cells.length}, cells=`, cells.slice(0, 7));
      
      // 只要有足够的列就处理（合并单元格时前几列可能为空）
      if (cells.length >= 4) {
        let subProcessDesc = cells[3] || '';
        let dataMovementType = cells[4] || '';
        let dataGroup = cells[5] || '';
        let dataAttributes = cells[6] || '';

        const moveSet = new Set(['E', 'R', 'W', 'X']);
        const normalizedMove = (dataMovementType || '').toUpperCase();
        if (!moveSet.has(normalizedMove)) {
          const idx = cells.findIndex(cell => moveSet.has((cell || '').toUpperCase()));
          if (idx !== -1) {
            dataMovementType = (cells[idx] || '').toUpperCase();
            subProcessDesc = cells[idx - 1] || subProcessDesc;
            dataGroup = cells[idx + 1] || dataGroup;
            const attrCells = cells.slice(idx + 2);
            dataAttributes = attrCells.filter(Boolean).join(' | ') || dataAttributes;
          }
        } else {
          dataMovementType = normalizedMove;
        }

        // 如果仍然缺失，尝试从行数推断
        if (!dataMovementType) {
          const fallbackIdx = cells.findIndex(cell => moveSet.has((cell || '').toUpperCase()));
          if (fallbackIdx !== -1) {
            dataMovementType = (cells[fallbackIdx] || '').toUpperCase();
          }
        }

        // 【关键修正】处理功能过程与子过程的层级关系
        // 规则：只有 E 类型的行才能有新的功能过程名称，R/W/X 行应该继承上一个 E 行的功能过程
        let rowFunctionalProcess = '';
        let rowFunctionalUser = '';
        let rowTriggerEvent = '';
        
        if (dataMovementType === 'E') {
          // E 类型行：如果有功能过程名称，更新当前功能过程
          if (cells[2]) {
            currentFunctionalProcess = cells[2];
          }
          if (cells[0]) currentFunctionalUser = cells[0];
          if (cells[1]) currentTriggerEvent = cells[1];
          
          rowFunctionalProcess = currentFunctionalProcess;
          rowFunctionalUser = cells[0] || currentFunctionalUser;
          rowTriggerEvent = cells[1] || currentTriggerEvent;
        } else {
          // R/W/X 类型行：功能过程列应该为空（继承上一个E行的值，但显示时留空）
          // 如果 AI 错误地填写了功能过程名称，我们忽略它
          if (cells[2] && cells[2] !== currentFunctionalProcess) {
            console.log(`修正: 行 ${rowIdx} 的功能过程 "${cells[2]}" 应为空（当前功能过程: "${currentFunctionalProcess}"）`);
          }
          // R/W/X 行的功能过程列留空，但内部记录当前功能过程用于数据组生成
          rowFunctionalProcess = ''; // 显示时留空
          rowFunctionalUser = ''; // 显示时留空
          rowTriggerEvent = ''; // 显示时留空
        }

        // 如果数据组或数据属性缺失，自动拼接功能过程+子过程描述，尽量保持唯一
        if (!dataGroup) {
          dataGroup = `${currentFunctionalProcess || '功能过程'}·${subProcessDesc || '数据'}`;
        }

        if (!dataAttributes) {
          dataAttributes = `${currentFunctionalProcess || '功能过程'}ID | ${subProcessDesc || '子过程'}字段 | 记录时间`;
        }

        dataAttributes = ensureMinimumAttributes(dataAttributes, currentFunctionalProcess, subProcessDesc);

        dataGroup = sanitizeText(dataGroup);
        dataAttributes = sanitizeText(dataAttributes);

        // 记录待处理的行数据，稍后统一处理重复
        pendingRows.push({
          functionalUser: rowFunctionalUser,
          triggerEvent: rowTriggerEvent,
          functionalProcess: rowFunctionalProcess,
          subProcessDesc,
          dataMovementType,
          dataGroup,
          dataAttributes,
          rowIdx,
          _parentProcess: currentFunctionalProcess // 内部使用，记录所属的功能过程
        });
      }
    });

    // 第二遍：处理重复的数据组和数据属性（调用AI智能去重）
    const tableData = [];
    const seenGroupsMap = new Map(); // 记录已出现的数据组及其来源
    const seenAttrsMap = new Map();  // 记录已出现的数据属性及其来源

    for (const row of pendingRows) {
      let { dataGroup, dataAttributes, subProcessDesc, functionalProcess, _parentProcess } = row;
      // 使用 _parentProcess 作为实际的功能过程名称（用于去重和生成）
      const actualProcess = _parentProcess || functionalProcess || '';
      
      // 处理数据组重复 - 直接结合关键词生成新名称，不使用括号
      const groupKey = dataGroup.toLowerCase();
      if (seenGroupsMap.has(groupKey)) {
        const existingNames = Array.from(seenGroupsMap.values()).map(v => v.name);
        // 调用AI生成新的完整名称（关键词+原内容结合）
        const newName = await aiGenerateUniqueName(dataGroup, subProcessDesc, actualProcess, existingNames);
        console.log(`数据组去重: "${dataGroup}" -> "${newName}"`);
        dataGroup = newName;
      }
      seenGroupsMap.set(dataGroup.toLowerCase(), { name: dataGroup, desc: subProcessDesc });

      // 处理数据属性重复 - 将新生成的字段添加到原有字段中，并打乱顺序
      const attrKey = dataAttributes.toLowerCase();
      if (seenAttrsMap.has(attrKey)) {
        const existingNames = Array.from(seenAttrsMap.values()).map(v => v.name);
        // 调用专门的属性去重函数，生成新字段名
        const newFieldName = await aiGenerateUniqueAttrName(dataAttributes, subProcessDesc, actualProcess, existingNames, dataGroup);
        
        // 将原有字段拆分成数组（支持 | 或 , 或 、 分隔）
        let fieldsArray = dataAttributes.split(/[|,、]/).map(f => f.trim()).filter(Boolean);
        
        // 将新生成的字段添加到数组中
        fieldsArray.push(newFieldName);
        
        // 打乱字段顺序（Fisher-Yates 洗牌算法）
        for (let i = fieldsArray.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [fieldsArray[i], fieldsArray[j]] = [fieldsArray[j], fieldsArray[i]];
        }
        
        // 重新组合成字符串
        const newDataAttributes = ensureMinimumAttributes(fieldsArray.join(', '), actualProcess, subProcessDesc);
        console.log(`数据属性去重: "${dataAttributes}" -> "${newDataAttributes}"`);
        dataAttributes = newDataAttributes;
      }
      seenAttrsMap.set(dataAttributes.toLowerCase(), { name: dataAttributes, desc: subProcessDesc });

      // 移除内部字段 _parentProcess，不输出到最终结果
      const { _parentProcess: _, ...cleanRow } = row;
      tableData.push({
        ...cleanRow,
        dataGroup,
        dataAttributes
      });
    }

    // ========== 最终系统性去重检查 ==========
    // 对整个 tableData 进行最终的去重检查，确保数据组和数据属性没有重复
    const finalTableData = await performFinalDeduplication(tableData);

    res.json({ success: true, tableData: finalTableData });
  } catch (error) {
    console.error('解析表格失败:', error);
    res.status(500).json({ error: '解析表格失败: ' + error.message });
  }
});

// 静态资源托管（生产模式）
const CLIENT_DIST_PATH = path.join(__dirname, '../client/dist');
if (fs.existsSync(CLIENT_DIST_PATH)) {
  app.use(express.static(CLIENT_DIST_PATH));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST_PATH, 'index.html'));
  });
} else {
  console.warn('⚠️  未检测到 client/dist 构建目录，生产环境将无法提供前端静态资源');
}

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 Cosmic拆分智能体服务器运行在 http://localhost:${PORT}`);
  console.log(`📋 API密钥状态: ${process.env.OPENAI_API_KEY ? '已配置' : '未配置'}`);
  if (fs.existsSync(CLIENT_DIST_PATH)) {
    console.log('🖥️  静态前端: 已启用 client/dist 产物');
  }
});
