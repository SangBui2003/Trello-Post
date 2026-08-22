import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Settings, ArrowRight } from 'lucide-react';

export default function TrelloImportModal({ isOpen, onClose, onImport, queueId }) {
  const { t } = require('react-i18next').useTranslation();
  
  const [step, setStep] = useState('settings'); // settings, browse, loading
  const [config, setConfig] = useState({ apiKey: '', apiToken: '' });
  
  const [boards, setBoards] = useState([]);
  const [lists, setLists] = useState([]);
  const [cards, setCards] = useState([]);
  
  const [selectedBoard, setSelectedBoard] = useState('');
  const [selectedList, setSelectedList] = useState('');
  const [selectedCards, setSelectedCards] = useState([]);
  
  const [loadingMsg, setLoadingMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      window.desktopApp.getTrelloConfig().then(cfg => {
        if (cfg) {
          setConfig(cfg);
          if (cfg.apiKey && cfg.apiToken) {
            setStep('browse');
            loadBoardsAndPreselect();
          } else {
            setStep('settings');
          }
        }
      });
    } else {
      // Reset state on close but keep boards/lists cache
      setSelectedCards([]);
      setLoadingMsg('');
    }
  }, [isOpen, queueId]);

  const loadBoardsAndPreselect = async () => {
    try {
      setLoadingMsg('Đang lấy danh sách Bảng (Boards)...');
      setStep('loading');
      const b = await window.desktopApp.getTrelloBoards();
      setBoards(b);

      const selections = await window.desktopApp.getTrelloSelections(queueId || 'new');
      const lastBoardId = selections?.boardId || '';
      const lastListId = selections?.listId || '';

      if (lastBoardId && b.some(board => board.id === lastBoardId)) {
        setSelectedBoard(lastBoardId);
        
        setLoadingMsg('Đang tự động lấy danh sách Lists...');
        const l = await window.desktopApp.getTrelloLists(lastBoardId);
        setLists(l);

        if (lastListId && l.some(list => list.id === lastListId)) {
          setSelectedList(lastListId);
          
          setLoadingMsg('Đang tự động lấy danh sách Cards...');
          const c = await window.desktopApp.getTrelloCards(lastListId);
          setCards(c);
        }
      }
      setStep('browse');
    } catch (e) {
      console.error('Lỗi preselect Trello:', e);
      setStep('browse');
    }
  };

  const handleBoardChange = async (boardId) => {
    setSelectedBoard(boardId);
    setSelectedList('');
    setSelectedCards([]);
    setLists([]);
    setCards([]);
    
    if (boardId) {
      await window.desktopApp.saveTrelloSelections({ queueId: queueId || 'new', boardId, listId: '' });
      try {
        setLoadingMsg('Đang lấy danh sách Lists...');
        setStep('loading');
        const l = await window.desktopApp.getTrelloLists(boardId);
        setLists(l);
        setStep('browse');
      } catch (e) {
        alert('Lỗi lấy Lists: ' + e.message);
        setStep('browse');
      }
    } else {
      await window.desktopApp.saveTrelloSelections({ queueId: queueId || 'new', boardId: '', listId: '' });
    }
  };

  const handleListChange = async (listId) => {
    setSelectedList(listId);
    setSelectedCards([]);
    setCards([]);
    
    if (listId) {
      await window.desktopApp.saveTrelloSelections({ queueId: queueId || 'new', boardId: selectedBoard, listId });
      try {
        setLoadingMsg('Đang lấy danh sách Cards...');
        setStep('loading');
        const c = await window.desktopApp.getTrelloCards(listId);
        setCards(c);
        setStep('browse');
      } catch (e) {
        alert('Lỗi lấy Cards: ' + e.message);
        setStep('browse');
      }
    } else {
      await window.desktopApp.saveTrelloSelections({ queueId: queueId || 'new', boardId: selectedBoard, listId: '' });
    }
  };

  const handleSaveSettings = async () => {
    if (!config.apiKey || !config.apiToken) return alert('Vui lòng nhập đủ Key và Token.');
    await window.desktopApp.saveTrelloConfig(config);
    loadBoardsAndPreselect();
  };

  const handleImport = async () => {
    if (selectedCards.length === 0) return alert('Vui lòng chọn ít nhất 1 thẻ.');

    setStep('loading');
    const importedPosts = [];
    
    try {
      const ctaList = await window.desktopApp.getCTAConfig();

      for (let i = 0; i < selectedCards.length; i++) {
        const cardId = selectedCards[i];
        const card = cards.find(c => c.id === cardId);
        if (!card) continue;

        const desc = card.desc || '';
        const urlMatch = desc.match(/(https?:\/\/[^\s\n]+)/);
        if (!urlMatch) {
          alert(`Bỏ qua thẻ "${card.name}": Không tìm thấy link nào trong phần mô tả.`);
          continue;
        }
        
        const originalLink = urlMatch[0];
        const cleanedDesc = desc.replace(originalLink, '').trim();
        const baseContent = cleanedDesc ? `${card.name}\n\n${cleanedDesc}` : card.name;

        setLoadingMsg(`Thẻ ${i+1}/${selectedCards.length}: Đang mở trình duyệt lấy link Wrap (Tinfosmedia)... Vui lòng đợi...`);
        
        const wrappedLink = await window.desktopApp.wrapTinfosLink(originalLink);

        setLoadingMsg(`Thẻ ${i+1}/${selectedCards.length}: Đang chuẩn bị nội dung...`);
        const cta = ctaList.length > 0 ? ctaList[Math.floor(Math.random() * ctaList.length)] : "";
        
        setLoadingMsg(`Thẻ ${i+1}/${selectedCards.length}: Đang tải ảnh đính kèm từ Trello...`);
        const imageResult = await window.desktopApp.downloadTrelloImage({ cardId: card.id, fileName: card.name });

        importedPosts.push({
          content: baseContent + '\n𝐅𝐮𝐥𝐥 𝐝𝐞𝐭𝐚𝐢𝐥𝐬 𝐯𝐢𝐚 🔗 𝐢𝐧 𝐜𝐨𝐦𝐦𝐞𝐧𝐭𝐬 👇',
          commentText: `${cta} ${wrappedLink}`,
          imagePath: imageResult?.filePath || '',
          imageBase64: imageResult?.base64 || ''
        });
      }
      
      if (importedPosts.length > 0) {
        onImport(importedPosts);
      }
      onClose();
    } catch (e) {
      alert('Lỗi Import: ' + e.message);
      setStep('browse');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center">
            <span className="w-8 h-8 rounded bg-blue-100 text-blue-600 flex items-center justify-center mr-3">
              <Search size={18} />
            </span>
            Nhập bài viết từ Trello
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-slate-600 dark:text-slate-400 font-medium text-center">{loadingMsg}</p>
            </div>
          )}

          {step === 'settings' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded-lg text-sm mb-6 flex items-start">
                <Settings className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
                <p>Để bắt đầu, vui lòng nhập Trello API Key và Token. Bạn có thể lấy thông tin này tại <a href="https://trello.com/app-key" target="_blank" rel="noreferrer" className="underline font-medium">Trello Power-Up Admin</a>.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Trello API Key</label>
                <input 
                  type="text" 
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={config.apiKey}
                  onChange={e => setConfig({...config, apiKey: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Trello Token</label>
                <input 
                  type="password" 
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={config.apiToken}
                  onChange={e => setConfig({...config, apiToken: e.target.value})}
                />
              </div>
            </div>
          )}

          {step === 'browse' && (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                 <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Lựa chọn nội dung</h3>
                 <button onClick={() => setStep('settings')} className="text-sm text-blue-600 hover:underline">Sửa cấu hình Trello</button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Bảng (Board)</label>
                  <select 
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    value={selectedBoard}
                    onChange={e => handleBoardChange(e.target.value)}
                  >
                    <option value="">-- Chọn Bảng --</option>
                    {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Danh sách (List)</label>
                  <select 
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                    value={selectedList}
                    onChange={e => handleListChange(e.target.value)}
                    disabled={!selectedBoard}
                  >
                    <option value="">-- Chọn Danh sách --</option>
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-end mb-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Thẻ bài viết (Cards)</label>
                  {cards.length > 0 && (
                    <button 
                      onClick={() => {
                        if (selectedCards.length === cards.length) {
                          setSelectedCards([]);
                        } else {
                          setSelectedCards(cards.map(c => c.id));
                        }
                      }}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {selectedCards.length === cards.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                    </button>
                  )}
                </div>
                <div className="border border-slate-200 dark:border-slate-600 rounded-lg h-60 overflow-y-auto bg-slate-50 dark:bg-slate-900/50">
                  {cards.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 text-sm italic mt-8">Chưa có dữ liệu. Vui lòng chọn List.</div>
                  ) : (
                    <ul className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {cards.map(c => {
                        const isSelected = selectedCards.includes(c.id);
                        return (
                          <li 
                            key={c.id} 
                            className={`p-3 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center ${isSelected ? 'bg-blue-100 dark:bg-blue-900/40 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                            onClick={() => {
                              setSelectedCards(prev => 
                                prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                              );
                            }}
                          >
                            <div className={`w-5 h-5 rounded-[6px] border flex-shrink-0 mr-3 flex items-center justify-center transition-colors text-[10px] font-bold ${isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-transparent'}`}>
                              {isSelected ? selectedCards.indexOf(c.id) + 1 : ''}
                            </div>
                            <span className="text-slate-800 dark:text-slate-200 text-sm font-medium truncate select-none">{c.name}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-600 transition-colors"
            disabled={step === 'loading'}
          >
            Hủy
          </button>
          
          {step === 'settings' && (
            <button 
              onClick={handleSaveSettings}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              Lưu cấu hình
            </button>
          )}

          {step === 'browse' && (
            <button 
              onClick={handleImport}
              disabled={selectedCards.length === 0}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center shadow-sm ${selectedCards.length === 0 ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              Tiến hành Nhập {selectedCards.length > 0 ? `(${selectedCards.length})` : ''}
              <ArrowRight size={16} className="ml-2" />
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
