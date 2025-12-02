import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Upload,
  FileText,
  Send,
  Download,
  Settings,
  Bot,
  User,
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
  FileSpreadsheet,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Eye,
  Table,
  Info,
  Zap
} from 'lucide-react';

function App() {
  // 状态管理
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [documentContent, setDocumentContent] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://open.bigmodel.cn/api/paas/v4');
  const [modelName, setModelName] = useState('glm-4-flash');
  const [apiStatus, setApiStatus] = useState({ hasApiKey: false });
  const [tableData, setTableData] = useState([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showTableView, setShowTableView] = useState(false);
  const [minFunctionCount, setMinFunctionCount] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('minFunctionCount');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    }
    return 30;
  });

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // 检查API状态
  useEffect(() => {
    checkApiStatus();
  }, []);

  // 持久化最小功能过程数量
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('minFunctionCount', String(minFunctionCount));
    }
  }, [minFunctionCount]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const checkApiStatus = async () => {
    try {
      const res = await axios.get('/api/health');
      setApiStatus(res.data);
      if (res.data.baseUrl) {
        setBaseUrl(res.data.baseUrl);
      }
    } catch (error) {
      console.error('检查API状态失败:', error);
    }
  };

  // 保存API配置
  const saveApiConfig = async () => {
    try {
      await axios.post('/api/config', { apiKey, baseUrl });
      setShowSettings(false);
      checkApiStatus();
      alert('API配置已保存');
    } catch (error) {
      alert('保存配置失败: ' + error.message);
    }
  };

  // 拖拽上传处理
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有当离开拖拽区域时才取消状态
    if (e.currentTarget === dropZoneRef.current && !e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  }, []);

  // 文件选择处理
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // 重置input以便可以重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 处理文件上传
  const processFile = async (file) => {
    // 清除之前的错误
    setErrorMessage('');

    // 检查文件类型
    const allowedExtensions = ['.docx', '.txt', '.md'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      setErrorMessage(`不支持的文件格式: ${ext}。请上传 .docx, .txt 或 .md 文件`);
      return;
    }

    // 检查文件大小
    if (file.size > 50 * 1024 * 1024) {
      setErrorMessage('文件大小超过限制（最大50MB）');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      setIsLoading(true);
      setUploadProgress(0);

      const res = await axios.post('/api/parse-word', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(progress);
        }
      });

      if (res.data.success) {
        setDocumentContent(res.data.text);
        setDocumentName(res.data.filename);
        setUploadProgress(100);

        // 添加系统消息
        const wordCount = res.data.wordCount || res.data.text.length;
        setMessages(prev => [...prev, {
          role: 'system',
          content: `📄 已成功导入文档: ${res.data.filename}\n📊 文档大小: ${(res.data.fileSize / 1024).toFixed(2)} KB | 字符数: ${wordCount}\n\n文档内容预览:\n${res.data.text.substring(0, 800)}${res.data.text.length > 800 ? '\n\n... (点击"预览文档"查看完整内容)' : ''}`
        }]);

        // 自动开始分析 - 先检查最新的API状态
        const statusRes = await axios.get('/api/health');
        if (statusRes.data.hasApiKey) {
          setApiStatus(statusRes.data);
          await startAnalysis(res.data.text);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '⚠️ 请先配置API密钥才能使用AI分析功能。点击右上角的设置按钮进行配置。\n\n推荐使用免费的智谱GLM-4-Flash API：\n1. 访问 https://bigmodel.cn 注册账号\n2. 在控制台获取API Key\n3. 在设置中填入API Key'
          }]);
        }
      }
    } catch (error) {
      console.error('文档解析失败:', error);
      const errorMsg = error.response?.data?.error || error.message;
      setErrorMessage(`文档解析失败: ${errorMsg}`);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `❌ 文档解析失败: ${errorMsg}`
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  // 开始AI分析 - 循环调用直到完成
  const startAnalysis = async (content) => {
    if (!apiStatus.hasApiKey) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ 请先配置API密钥才能使用AI分析功能。点击右上角的设置按钮进行配置。'
      }]);
      return;
    }

    setIsLoading(true);
    setStreamingContent('');
    setTableData([]); // 清空之前的表格数据

    let allTableData = [];
    let round = 1;
    const maxRounds = 12; // 最多循环12次，防止无限循环
    let uniqueFunctions = [];
    const globalRowSet = new Set(); // 仅用于整行去重

    try {
      while (round <= maxRounds) {
        if (uniqueFunctions.length >= minFunctionCount) {
          break;
        }

        // 更新进度提示
        setMessages(prev => {
          const filtered = prev.filter(m => !m.content.startsWith('🔄'));
          return [...filtered, {
            role: 'system',
            content: `🔄 第 ${round} 轮分析中... 已识别 ${allTableData.length} 个子过程 / 目标 ${minFunctionCount * 4} 数据移动`
          }];
        });

        const response = await axios.post('/api/continue-analyze', {
          documentContent: content,
          previousResults: allTableData,
          round: round,
          targetFunctions: minFunctionCount
        });

        if (response.data.success) {
          const replyContent = response.data.reply;

          // 解析表格数据 - 直接使用后端已处理好的数据，不再前端二次处理
          try {
            const tableRes = await axios.post('/api/parse-table', { markdown: replyContent });
            console.log(`第 ${round} 轮解析结果:`, tableRes.data);
            if (tableRes.data.success && tableRes.data.tableData.length > 0) {
              // 直接使用后端返回的数据，不做额外过滤
              const newData = tableRes.data.tableData;
              console.log(`第 ${round} 轮获取 ${newData.length} 条数据`);

              // 统计数据移动类型分布
              const typeCount = { E: 0, R: 0, W: 0, X: 0 };
              newData.forEach(row => {
                const t = (row.dataMovementType || '').toUpperCase();
                if (typeCount[t] !== undefined) typeCount[t]++;
              });
              console.log(`数据移动类型分布:`, typeCount);

              if (newData.length > 0) {
                allTableData = [...allTableData, ...newData];
                setTableData(allTableData);
                console.log(`第 ${round} 轮新增 ${newData.length} 条，总计 ${allTableData.length} 条`);
              }
            }
          } catch (e) {
            console.log(`第 ${round} 轮表格解析失败`);
          }

          // 显示本轮结果
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.startsWith('🔄'));
            return [...filtered, {
              role: 'assistant',
              content: `**第 ${round} 轮完成** (已识别 ${allTableData.length} 个子过程)\n\n${replyContent}`
            }];
          });

          uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];
          const reachedTarget = uniqueFunctions.length >= minFunctionCount;

          if (reachedTarget) {
            console.log(`达到用户设定的最少功能过程数量: ${minFunctionCount}`);
            break;
          }

          // 检查是否完成
          if (response.data.isDone && !reachedTarget) {
            setMessages(prev => [...prev, {
              role: 'system',
              content: '⚠️ AI表示已拆分完成，但尚未达到目标数量，继续尝试扩展覆盖...'
            }]);
          } else if (response.data.isDone && reachedTarget) {
            console.log('AI表示已完成所有功能过程');
            break;
          }

          // 如果这轮没有新增数据，可能已经完成
          const tableRes = await axios.post('/api/parse-table', { markdown: replyContent }).catch(() => null);
          if (!tableRes?.data?.tableData?.length && round > 1) {
            console.log('本轮无新增数据，结束循环');
            break;
          }
        }

        round++;

        // 轮次间延迟
        if (round <= maxRounds) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }

      // 统计功能过程数量
      uniqueFunctions = [...new Set(allTableData.map(r => r.functionalProcess).filter(Boolean))];
      const reachedTarget = uniqueFunctions.length >= minFunctionCount;

      // 最终汇总
      setMessages(prev => {
        const filtered = prev.filter(m => !m.content.startsWith('🔄'));
        return [...filtered, {
          role: 'assistant',
          content: `🎉 **分析完成！**\n\n经过 **${round}** 轮分析，共识别：\n- **${uniqueFunctions.length}** 个功能过程（目标 ${minFunctionCount} 个${reachedTarget ? ' ✅' : ' ⚠️ 未达标'}）\n- **${allTableData.length}** 个子过程（CFP点数）\n\n数据移动类型分布：\n- 输入(E): ${allTableData.filter(r => r.dataMovementType === 'E').length}\n- 读取(R): ${allTableData.filter(r => r.dataMovementType === 'R').length}\n- 写入(W): ${allTableData.filter(r => r.dataMovementType === 'W').length}\n- 输出(X): ${allTableData.filter(r => r.dataMovementType === 'X').length}\n\n点击"查看表格"或"导出Excel"查看完整结果。`
        }];
      });

      if (!reachedTarget) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ 未达到用户设定的最少功能过程数量（${minFunctionCount} 个）。建议：\n- 检查原始文档是否有更多可拆分的功能描述\n- 提高最大轮数或降低目标数量\n- 重新上传更详细的需求文档`
        }]);
      }

    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 分析失败: ${error.response?.data?.error || error.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 发送消息
  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage = { role: 'user', content: inputText };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setStreamingContent('');

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentContent: documentContent,
          messages: [...messages.filter(m => m.role !== 'system'), userMessage]
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                setStreamingContent(fullContent);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: fullContent
      }]);
      setStreamingContent('');

      // 尝试解析表格数据
      parseTableFromMarkdown(fullContent);

    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 发送失败: ${error.message}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 从Markdown解析表格
  const parseTableFromMarkdown = async (markdown) => {
    try {
      const res = await axios.post('/api/parse-table', { markdown });
      if (res.data.success && res.data.tableData.length > 0) {
        setTableData(res.data.tableData);
      }
    } catch (error) {
      console.log('表格解析失败，可能没有有效表格');
    }
  };

  // 导出Excel
  const exportExcel = async () => {
    if (tableData.length === 0) {
      alert('没有可导出的数据，请先进行Cosmic拆分分析');
      return;
    }

    try {
      const response = await axios.post('/api/export-excel', {
        tableData,
        filename: documentName ? documentName.replace('.docx', '') + '_cosmic拆分结果' : 'cosmic拆分结果'
      }, {
        responseType: 'blob'
      });

      // 下载文件
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${documentName ? documentName.replace('.docx', '') + '_' : ''}cosmic拆分结果.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('导出失败: ' + error.message);
    }
  };

  // 复制内容
  const copyContent = (content) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 清空对话
  const clearChat = () => {
    setMessages([]);
    setDocumentContent('');
    setDocumentName('');
    setTableData([]);
    setStreamingContent('');
  };

  // 处理键盘事件
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Cosmic拆分智能体</h1>
              <p className="text-xs text-gray-500">基于AI的软件功能规模度量工具</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* API状态指示 */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${apiStatus.hasApiKey
                ? 'bg-green-100 text-green-700'
                : 'bg-yellow-100 text-yellow-700'
              }`}>
              {apiStatus.hasApiKey ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>API已连接</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4" />
                  <span>未配置API</span>
                </>
              )}
            </div>

            {/* 查看表格按钮 */}
            <button
              onClick={() => setShowTableView(true)}
              disabled={tableData.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Table className="w-4 h-4" />
              <span>查看表格</span>
            </button>

            {/* 导出按钮 */}
            <button
              onClick={exportExcel}
              disabled={tableData.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>导出Excel</span>
            </button>

            {/* 清空按钮 */}
            <button
              onClick={clearChat}
              className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="清空对话"
            >
              <Trash2 className="w-5 h-5" />
            </button>

            {/* 设置按钮 */}
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
              title="API设置"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：文件上传和文档预览 */}
          <div className="lg:col-span-1 space-y-4">
            {/* 文件上传区 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-500" />
                导入Word文档
              </h2>

              <div
                ref={dropZoneRef}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${isDragging
                    ? 'border-blue-500 bg-blue-50 scale-105'
                    : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                  }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.txt,.md"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {isDragging ? (
                  <>
                    <Upload className="w-12 h-12 text-blue-500 mx-auto mb-3 animate-bounce" />
                    <p className="text-blue-600 font-medium">松开鼠标上传文件</p>
                  </>
                ) : (
                  <>
                    <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">点击或拖拽上传</p>
                    <p className="text-sm text-gray-400 mt-1">支持 .docx, .txt, .md 格式</p>
                  </>
                )}
              </div>

              {/* 上传进度 */}
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="mt-4">
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>上传中...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 错误提示 */}
              {errorMessage && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-red-700">{errorMessage}</p>
                    <button
                      onClick={() => setErrorMessage('')}
                      className="text-xs text-red-500 hover:text-red-700 mt-1"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              )}

              {/* 最少功能过程设置 */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-700">最少功能过程数量</p>
                    <p className="text-xs text-gray-500">达到该数量后才停止分析（默认30，推荐30-120）</p>
                  </div>
                  <span className="text-lg font-semibold text-blue-600">{minFunctionCount}</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="150"
                  step="5"
                  value={minFunctionCount}
                  onChange={(e) => setMinFunctionCount(Number(e.target.value))}
                  className="w-full"
                />
                <input
                  type="number"
                  min="5"
                  max="200"
                  value={minFunctionCount}
                  onChange={(e) => setMinFunctionCount(Math.min(200, Math.max(5, Number(e.target.value) || 5)))}
                  className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* 已上传文件 */}
              {documentName && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-blue-500" />
                    <span className="text-sm text-blue-700 truncate flex-1">{documentName}</span>
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setShowPreview(true)}
                      className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      预览文档
                    </button>
                    <button
                      onClick={() => {
                        if (apiStatus.hasApiKey) {
                          startAnalysis(documentContent);
                        } else {
                          setShowSettings(true);
                        }
                      }}
                      className="text-xs px-2 py-1 bg-green-100 text-green-600 rounded hover:bg-green-200 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      重新分析
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 使用说明 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">使用说明</h2>
              <div className="space-y-3 text-sm text-gray-600">
                <div className="flex gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">1</span>
                  <p>上传包含功能过程描述的Word文档</p>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">2</span>
                  <p>AI自动分析并生成Cosmic拆分表格</p>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">3</span>
                  <p>通过对话优化拆分结果</p>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">4</span>
                  <p>导出Excel格式的拆分结果</p>
                </div>
              </div>
            </div>

            {/* 数据统计 */}
            {tableData.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">拆分统计</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-blue-600">{tableData.length}</p>
                    <p className="text-sm text-gray-600">子过程数</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{tableData.length}</p>
                    <p className="text-sm text-gray-600">CFP点数</p>
                  </div>
                  <div className="bg-purple-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-purple-600">
                      {tableData.filter(r => r.dataMovementType === 'E').length}
                    </p>
                    <p className="text-sm text-gray-600">输入(E)</p>
                  </div>
                  <div className="bg-orange-50 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-orange-600">
                      {tableData.filter(r => r.dataMovementType === 'X').length}
                    </p>
                    <p className="text-sm text-gray-600">输出(X)</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：对话区域 */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 h-[calc(100vh-180px)] flex flex-col">
              {/* 对话消息区 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 && !streamingContent && (
                  <div className="text-center py-12">
                    <Bot className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-600 mb-2">欢迎使用Cosmic拆分智能体</h3>
                    <p className="text-gray-400">上传Word文档开始分析，或直接输入功能过程描述</p>
                  </div>
                )}

                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user'
                        ? 'bg-blue-500'
                        : msg.role === 'system'
                          ? 'bg-gray-500'
                          : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                      }`}>
                      {msg.role === 'user' ? (
                        <User className="w-4 h-4 text-white" />
                      ) : (
                        <Bot className="w-4 h-4 text-white" />
                      )}
                    </div>
                    <div className={`max-w-[80%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                      <div className={`inline-block p-4 rounded-2xl ${msg.role === 'user'
                          ? 'bg-blue-500 text-white'
                          : msg.role === 'system'
                            ? 'bg-gray-100 text-gray-700'
                            : 'bg-gray-50 text-gray-800'
                        }`}>
                        {msg.role === 'assistant' ? (
                          <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                      {msg.role === 'assistant' && (
                        <button
                          onClick={() => copyContent(msg.content)}
                          className="mt-2 text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                        >
                          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copied ? '已复制' : '复制'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* 流式输出 */}
                {streamingContent && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="max-w-[80%]">
                      <div className="inline-block p-4 rounded-2xl bg-gray-50 text-gray-800">
                        <div className="markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {streamingContent}
                          </ReactMarkdown>
                        </div>
                        <span className="typing-cursor"></span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 加载状态 */}
                {isLoading && !streamingContent && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="bg-gray-50 rounded-2xl p-4 flex items-center gap-2">
                      <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                      <span className="text-gray-600">AI正在分析中...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* 输入区 */}
              <div className="border-t border-gray-200 p-4">
                <div className="flex gap-3">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入功能过程描述或与AI对话..."
                    className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={2}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!inputText.trim() || isLoading}
                    className="px-6 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">按 Enter 发送，Shift + Enter 换行</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 m-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-800">API设置</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              {/* 快速配置 */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-5 h-5 text-green-600" />
                  <span className="font-medium text-green-800">推荐：智谱GLM-4-Flash（免费）</span>
                </div>
                <p className="text-sm text-green-700 mb-3">
                  无限tokens、永久有效、无需付费
                </p>
                <button
                  onClick={() => {
                    setBaseUrl('https://open.bigmodel.cn/api/paas/v4');
                    setModelName('glm-4-flash');
                  }}
                  className="text-sm px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600"
                >
                  一键填入智谱配置
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Base URL
                </label>
                <select
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                >
                  <option value="https://open.bigmodel.cn/api/paas/v4">智谱GLM (免费)</option>
                  <option value="https://api.siliconflow.cn/v1">SiliconCloud (免费)</option>
                  <option value="https://api.openai.com/v1">OpenAI</option>
                  <option value="https://api.deepseek.com/v1">DeepSeek</option>
                  <option value="https://ark.cn-beijing.volces.com/api/v3">豆包/火山方舟</option>
                  <option value="custom">自定义...</option>
                </select>
                {baseUrl === 'custom' && (
                  <input
                    type="text"
                    value=""
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="输入自定义API地址"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入你的API密钥..."
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="bg-blue-50 rounded-lg p-4 text-sm">
                <p className="font-medium text-blue-800 mb-2 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  免费API获取方式
                </p>
                <div className="space-y-2 text-blue-700">
                  <div className="flex items-start gap-2">
                    <span className="font-bold">智谱GLM:</span>
                    <span>访问 <a href="https://bigmodel.cn" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-900">bigmodel.cn</a> 注册获取</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-bold">SiliconCloud:</span>
                    <span>访问 <a href="https://cloud.siliconflow.cn" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-900">cloud.siliconflow.cn</a> 注册获取</span>
                  </div>
                </div>
              </div>

              <button
                onClick={saveApiConfig}
                className="w-full bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600 transition-colors font-medium"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 文档预览弹窗 */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl m-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                文档预览: {documentName}
              </h2>
              <button
                onClick={() => setShowPreview(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 p-4 rounded-lg">
                {documentContent}
              </pre>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(documentContent);
                  alert('文档内容已复制到剪贴板');
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                复制内容
              </button>
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 表格预览弹窗 */}
      {showTableView && tableData.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl m-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <Table className="w-5 h-5 text-blue-500" />
                Cosmic拆分结果表格 ({tableData.length} 条记录)
              </h2>
              <button
                onClick={() => setShowTableView(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-blue-500 text-white">
                    <th className="border border-blue-600 px-3 py-2 text-left">功能用户</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">触发事件</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">功能过程</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">子过程描述</th>
                    <th className="border border-blue-600 px-3 py-2 text-center w-20">类型</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">数据组</th>
                    <th className="border border-blue-600 px-3 py-2 text-left">数据属性</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="border border-gray-200 px-3 py-2">{row.functionalUser}</td>
                      <td className="border border-gray-200 px-3 py-2">{row.triggerEvent}</td>
                      <td className="border border-gray-200 px-3 py-2">{row.functionalProcess}</td>
                      <td className="border border-gray-200 px-3 py-2">{row.subProcessDesc}</td>
                      <td className="border border-gray-200 px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${row.dataMovementType === 'E' ? 'bg-green-100 text-green-700' :
                            row.dataMovementType === 'R' ? 'bg-blue-100 text-blue-700' :
                              row.dataMovementType === 'W' ? 'bg-orange-100 text-orange-700' :
                                row.dataMovementType === 'X' ? 'bg-purple-100 text-purple-700' :
                                  'bg-gray-100 text-gray-700'
                          }`}>
                          {row.dataMovementType}
                        </span>
                      </td>
                      <td className="border border-gray-200 px-3 py-2">{row.dataGroup}</td>
                      <td className="border border-gray-200 px-3 py-2">{row.dataAttributes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={exportExcel}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                导出Excel
              </button>
              <button
                onClick={() => setShowTableView(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Red Alert GI Watermark */}
      <div className="gi-watermark">
        <div className="gi-soldier"></div>
      </div>
    </div>
  );
}

export default App;
