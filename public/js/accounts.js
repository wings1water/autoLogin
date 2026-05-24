/**
 * 邮箱账号管理模块
 * 处理导入/导出/删除/搜索等操作
 */

// ==================== 数据操作 ====================
let _cachedAccounts = [];
let _accountGroupFilter = 'all';

async function loadAccounts() {
  try {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    _cachedAccounts = data.accounts || [];
    return _cachedAccounts;
  } catch (err) {
    console.error('加载账号失败:', err);
    return [];
  }
}

async function loadFullAccounts() {
  try {
    const res = await fetch('/api/accounts/full');
    const data = await res.json();
    return data.accounts || [];
  } catch (err) {
    console.error('加载完整账号失败:', err);
    return [];
  }
}

function getAccountSearchKeyword() {
  return (document.getElementById('accountSearch')?.value || '').trim().toLowerCase();
}

function getAccountLoginEmail(account) {
  return (account.loginEmail || account.email || '').trim();
}

function hasLoginAlias(account) {
  const mailbox = (account.email || '').trim().toLowerCase();
  const login = getAccountLoginEmail(account).toLowerCase();
  return Boolean(mailbox && login && mailbox !== login);
}

function getAccountGroup(account) {
  return hasLoginAlias(account) ? 'alias' : 'primary';
}

function getAccountGroupLabel(group = _accountGroupFilter) {
  const labels = {
    all: '全部邮箱',
    primary: '主邮箱',
    alias: '别名邮箱',
  };
  return labels[group] || labels.all;
}

function accountMatchesCurrentGroup(account) {
  return _accountGroupFilter === 'all' || getAccountGroup(account) === _accountGroupFilter;
}

function formatAccountTitle(account) {
  return hasLoginAlias(account)
    ? `收信邮箱: ${account.email}\nChatGPT 登录: ${getAccountLoginEmail(account)}`
    : account.email;
}

function getFilteredAccounts(accounts = _cachedAccounts) {
  const searchKeyword = getAccountSearchKeyword();
  return accounts.filter(a => {
    if (!accountMatchesCurrentGroup(a)) return false;
    if (!searchKeyword) return true;
    return (
      (a.email || '').toLowerCase().includes(searchKeyword) ||
      getAccountLoginEmail(a).toLowerCase().includes(searchKeyword)
    );
  });
}

function updateAccountGroupTabs(accounts = _cachedAccounts) {
  const all = accounts.length;
  const alias = accounts.filter(hasLoginAlias).length;
  const primary = all - alias;
  const counts = { all, primary, alias };

  for (const [group, count] of Object.entries(counts)) {
    const el = document.getElementById(`accountGroup${group[0].toUpperCase()}${group.slice(1)}`);
    if (el) el.textContent = count;
  }

  document.querySelectorAll('.account-group-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.accountGroup === _accountGroupFilter);
  });
}

// ==================== 渲染邮箱列表 ====================
async function renderAccountList(highlightIds = null) {
  const accounts = await loadAccounts();
  const searchKeyword = getAccountSearchKeyword();
  const visible = getFilteredAccounts(accounts);

  const listEl = document.getElementById('accountList');
  const countEl = document.getElementById('accountCount');
  updateAccountGroupTabs(accounts);

  const oldCount = parseInt(countEl.textContent) || 0;
  countEl.textContent = searchKeyword || _accountGroupFilter !== 'all'
    ? `${visible.length}/${accounts.length}`
    : accounts.length;
  if (accounts.length !== oldCount) {
    countEl.classList.add('badge-pulse');
    setTimeout(() => countEl.classList.remove('badge-pulse'), 600);
  }

  if (accounts.length === 0) {
    listEl.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7L12 13L2 7"/></svg>
      <p>暂无邮箱</p><p class="text-muted">点击上方按钮导入</p>
    </div>`;
    return;
  }

  if (visible.length === 0) {
    const title = searchKeyword ? '未找到邮箱' : `${getAccountGroupLabel()}为空`;
    const hint = searchKeyword ? '换个关键词试试' : (_accountGroupFilter === 'alias' ? '扫描订阅邮件后会自动导入别名邮箱' : '导入邮箱后会显示在这里');
    listEl.innerHTML = `<div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <p>${escapeHtml(title)}</p><p class="text-muted">${escapeHtml(hint)}</p>
    </div>`;
    return;
  }

  let html = `<div class="select-all-wrapper">
    <input type="checkbox" class="account-checkbox" id="selectAll" />
    <label for="selectAll" style="cursor:pointer;">全选当前 ${visible.length} 个${_accountGroupFilter !== 'all' ? ` · ${escapeHtml(getAccountGroupLabel())}` : ''}</label>
    <button class="btn btn-ghost btn-small btn-danger-ghost" id="btnDeleteSelected" style="display:none;margin-left:auto;">删除选中</button>
  </div>`;

  visible.forEach((acc, i) => {
    const isNew = highlightIds && highlightIds.has(acc.id);
    const loginEmail = getAccountLoginEmail(acc);
    const aliasHtml = hasLoginAlias(acc)
      ? `<span class="account-login-email" title="${escapeAttr(loginEmail)}">ChatGPT: ${escapeHtml(loginEmail)}</span>`
      : '';
    const groupBadge = hasLoginAlias(acc)
      ? '<span class="account-type-badge alias">别名</span>'
      : '<span class="account-type-badge primary">主邮箱</span>';
    html += `<div class="account-item ${isNew ? 'account-item-new' : ''}" data-id="${acc.id}" style="animation-delay:${isNew ? i * 0.05 : 0}s">
      <input type="checkbox" class="account-checkbox account-check" data-id="${acc.id}" />
      <span class="account-email-wrap" title="${escapeAttr(formatAccountTitle(acc))}">
        <span class="account-email-line"><span class="account-email">${escapeHtml(acc.email)}</span>${groupBadge}</span>
        ${aliasHtml}
      </span>
      <button class="account-copy" data-email="${escapeAttr(acc.email)}" title="复制邮箱">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="account-delete" onclick="event.stopPropagation();deleteAccount('${acc.id}')" title="删除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  });

  listEl.innerHTML = html;

  // 事件绑定
  if (highlightIds && highlightIds.size > 0) {
    setTimeout(() => document.querySelectorAll('.account-item-new').forEach(el => el.classList.remove('account-item-new')), 3000);
  }

  document.getElementById('selectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.account-check').forEach(cb => {
      cb.checked = e.target.checked;
      cb.closest('.account-item')?.classList.toggle('selected', e.target.checked);
    });
    updateBulkDeleteButton();
  });

  document.querySelectorAll('.account-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.account-checkbox') || e.target.closest('.account-delete') || e.target.closest('.account-copy')) return;
      const cb = item.querySelector('.account-check');
      if (cb) { cb.checked = !cb.checked; item.classList.toggle('selected', cb.checked); updateSelectAllState(); updateBulkDeleteButton(); }
    });
  });

  document.querySelectorAll('.account-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.target.closest('.account-item')?.classList.toggle('selected', e.target.checked);
      updateSelectAllState();
      updateBulkDeleteButton();
    });
  });

  document.getElementById('btnDeleteSelected')?.addEventListener('click', deleteSelectedAccounts);

  document.querySelectorAll('.account-copy').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copyText(btn.dataset.email, '邮箱已复制'); });
  });
}

function updateSelectAllState() {
  const selectAll = document.getElementById('selectAll');
  if (!selectAll) return;
  const all = document.querySelectorAll('.account-check');
  const checked = document.querySelectorAll('.account-check:checked');
  selectAll.checked = all.length > 0 && all.length === checked.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
}

function updateBulkDeleteButton() {
  const btn = document.getElementById('btnDeleteSelected');
  if (!btn) return;
  const count = document.querySelectorAll('.account-check:checked').length;
  btn.style.display = count > 0 ? 'inline-flex' : 'none';
  if (count > 0) btn.textContent = `删除选中 (${count})`;
}

function getSelectedAccountIds() {
  const ids = [];
  document.querySelectorAll('.account-check:checked').forEach(cb => ids.push(cb.dataset.id));
  return ids;
}

// ==================== CRUD 操作 ====================
async function deleteAccount(id) {
  const item = document.querySelector(`.account-item[data-id="${id}"]`);
  if (item) item.classList.add('account-item-removing');

  setTimeout(async () => {
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      renderAccountList();
      showToast('已删除邮箱', 'info');
      addLog('删除邮箱', 'info');
    } catch (err) {
      showToast('删除失败: ' + err.message, 'error');
    }
  }, 300);
}

async function deleteSelectedAccounts() {
  const ids = getSelectedAccountIds();
  if (ids.length === 0) { showToast('请先选择要删除的邮箱', 'warning'); return; }
  if (!confirm(`确定要删除选中的 ${ids.length} 个邮箱吗？`)) return;

  ids.forEach(id => {
    const item = document.querySelector(`.account-item[data-id="${id}"]`);
    if (item) item.classList.add('account-item-removing');
  });

  setTimeout(async () => {
    try {
      await fetch('/api/accounts/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      renderAccountList();
      showToast(`已删除 ${ids.length} 个邮箱`, 'success');
      addLog(`批量删除 ${ids.length} 个邮箱`, 'info');
    } catch (err) {
      showToast('删除失败', 'error');
    }
  }, 300);
}

async function exportAccounts() {
  const ids = getSelectedAccountIds();
  try {
    const res = await fetch('/api/accounts/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids.length > 0 ? ids : undefined }),
    });
    const data = await res.json();
    if (data.success) {
      downloadTextFile(`outlook-accounts-${new Date().toISOString().slice(0, 10)}.txt`, data.content);
      copyText(data.content, `已导出 ${data.count} 个邮箱`);
      addLog(`导出 ${data.count} 个邮箱`, 'success');
    }
  } catch (err) {
    showToast('导出失败', 'error');
  }
}

function getVisibleAccountIds() {
  return getFilteredAccounts(_cachedAccounts).map(account => account.id);
}

function getSelectedOrAllMailboxIds() {
  const selected = getSelectedAccountIds();
  if (selected.length > 0) {
    const selectedIdSet = new Set(selected);
    return _cachedAccounts
      .filter(account => selectedIdSet.has(account.id) && getAccountGroup(account) === 'primary')
      .map(account => account.id);
  }

  return getFilteredAccounts(_cachedAccounts)
    .filter(account => getAccountGroup(account) === 'primary')
    .map(account => account.id);
}

function renderAliasDiscoveryResult(data) {
  const el = document.getElementById('aliasDiscoveryResult');
  if (!el) return;

  const imported = data.importedAccounts || [];
  const errors = data.errors || [];
  const aliases = data.aliases || [];
  const rows = imported.slice(0, 6).map(a => `
    <div class="alias-result-row">
      <span class="alias-mailbox">${escapeHtml(a.email)}</span>
      <span class="alias-arrow">→</span>
      <span class="alias-login">${escapeHtml(a.loginEmail)}</span>
    </div>
  `).join('');
  const extra = imported.length > 6
    ? `<div class="alias-result-muted">另有 ${imported.length - 6} 个别名已导入</div>`
    : '';
  const errorText = errors.length > 0
    ? renderAliasDiscoveryErrors(errors)
    : '';

  el.style.display = 'block';
  el.innerHTML = `
    <div class="alias-result-title">发现 ${aliases.length} 个别名，新增 ${imported.length} 个，跳过重复 ${data.duplicates || 0} 个</div>
    ${rows || '<div class="alias-result-muted">没有新的别名账号需要导入</div>'}
    ${extra}
    ${errorText}
  `;
}

function renderAliasDiscoveryErrors(errors) {
  const groups = new Map();

  for (const error of errors || []) {
    const protocol = String(error.protocol || 'unknown').toUpperCase();
    const reason = String(error.error || '未知错误');
    const key = `${protocol}|${reason}`;
    if (!groups.has(key)) {
      groups.set(key, { protocol, reason, emails: [] });
    }
    groups.get(key).emails.push(error.email || '未知邮箱');
  }

  const rows = [...groups.values()].map(group => {
    const emails = group.emails.slice(0, 5).map(escapeHtml).join('、');
    const more = group.emails.length > 5 ? ` 等 ${group.emails.length} 个` : '';
    return `<div class="alias-error-row">
      <span class="alias-error-protocol">${escapeHtml(group.protocol)}</span>
      <span class="alias-error-reason">${escapeHtml(group.reason)}</span>
      <span class="alias-error-emails">${emails}${more}</span>
    </div>`;
  }).join('');

  return `<div class="alias-result-warning">
    <div>${errors.length} 个邮箱扫描失败，可稍后重试</div>
    <div class="alias-error-list">${rows}</div>
  </div>`;
}

async function discoverAliasesFromPlanEmails() {
  const ids = getSelectedOrAllMailboxIds();
  if (ids.length === 0) {
    showToast('请先选择主邮箱，别名邮箱不需要扫描订阅邮件', 'warning');
    return;
  }

  const btn = document.getElementById('btnDiscoverAliases');
  setButtonLoading(btn, true);
  setStatus('loading', '扫描别名中...');

  try {
    const res = await fetch('/api/accounts/discover-aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids,
        limit: 30,
        subject: 'ChatGPT - Your new plan',
        protocols: ['imap', 'graph'],
        autoImport: true,
      }),
    });
    const data = await res.json();
    renderAliasDiscoveryResult(data);

    if (data.success) {
      if (data.imported > 0) {
        showToast(`已从订阅邮件导入 ${data.imported} 个别名账号`, 'success', 5000);
        addLog(`扫描订阅邮件：新增 ${data.imported} 个别名账号`, 'success');
      } else {
        showToast(data.discovered > 0 ? '发现的别名都已存在' : '没有发现新的订阅别名', 'info', 4000);
        addLog(`扫描订阅邮件：发现 ${data.discovered || 0} 个别名，新增 0 个`, 'info');
      }
      await renderAccountList();
      if (typeof renderLoginTable === 'function') renderLoginTable();
    } else {
      showToast(data.error || '扫描别名失败', 'warning', 5000);
      addLog(`扫描订阅邮件失败: ${data.error || '未知错误'}`, 'warning');
    }
  } catch (err) {
    showToast('扫描别名失败: ' + err.message, 'error', 5000);
    addLog('扫描订阅邮件异常: ' + err.message, 'error');
  } finally {
    setStatus('ready', '就绪');
    setButtonLoading(btn, false);
  }
}

// ==================== 导入解析（客户端预览） ====================
function isEmailLike(value) {
  return String(value || '').trim().includes('@');
}

function parseImportLinePreview(trimmed) {
  for (let dashCount = 4; dashCount >= 1; dashCount--) {
    const sep = '-'.repeat(dashCount);
    const rawParts = trimmed.split(sep).map(p => p.trim());
    let parts = null;

    if (rawParts.length === 4 && rawParts.every(p => p.length > 0)) {
      parts = rawParts;
    } else if (rawParts.length === 5 && rawParts.slice(0, 4).every(p => p.length > 0)) {
      parts = isEmailLike(rawParts[4])
        ? rawParts
        : [rawParts[0], rawParts[1], rawParts[2], rawParts.slice(3).join(sep).trim()];
    } else if (rawParts.length > 5) {
      const lastPart = rawParts[rawParts.length - 1];
      const hasLoginEmail = isEmailLike(lastPart);
      const base = rawParts.slice(0, 3);
      const refreshToken = rawParts.slice(3, hasLoginEmail ? -1 : undefined).join(sep).trim();

      if (base.every(p => p.length > 0) && refreshToken) {
        parts = hasLoginEmail
          ? [...base, refreshToken, lastPart]
          : [...base, refreshToken];
      }
    }

    if (
      parts &&
      (parts.length === 4 || parts.length === 5) &&
      parts.slice(0, 4).every(p => p.length > 0) &&
      (!parts[4] || isEmailLike(parts[4]))
    ) {
      return parts;
    }
  }

  return null;
}

function parseImportTextPreview(text) {
  const lines = text.trim().split('\n');
  const accounts = [];
  const errors = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parts = parseImportLinePreview(trimmed);

    if (!parts || (parts.length !== 4 && parts.length !== 5)) { errors.push(index); return; }
    if (!isEmailLike(parts[0])) { errors.push(index); return; }
    if (parts[4] && !isEmailLike(parts[4])) { errors.push(index); return; }
    accounts.push({ email: parts[0], loginEmail: parts[4] || '' });
  });

  return { accounts, errors, lines: lines.filter(l => l.trim()).length };
}

function updateImportPreview() {
  const textarea = document.getElementById('importTextarea');
  const previewEl = document.getElementById('importPreview');
  const text = textarea.value.trim();

  if (!text) {
    previewEl.innerHTML = '<span class="preview-hint">💡 粘贴邮箱数据后将自动预览，支持 Ctrl+Enter 快捷导入</span>';
    return;
  }

  const { accounts, errors, lines } = parseImportTextPreview(text);
  const aliases = accounts.filter(a => a.loginEmail && a.loginEmail.toLowerCase() !== a.email.toLowerCase()).length;
  let html = `<span class="preview-count">📋 识别 ${lines} 行`;
  if (accounts.length > 0) html += ` → <span class="preview-valid">✅ ${accounts.length} 个有效</span>`;
  if (aliases > 0) html += ` <span class="preview-alias">🔁 ${aliases} 个别名登录</span>`;
  if (errors.length > 0) html += ` <span class="preview-error">❌ ${errors.length} 个错误</span>`;
  html += '</span>';
  previewEl.innerHTML = html;
}

// ==================== 事件绑定 ====================
document.addEventListener('DOMContentLoaded', () => {
  renderAccountList();

  const importModal = document.getElementById('importModal');
  const importTextarea = document.getElementById('importTextarea');

  document.getElementById('btnOpenImport').addEventListener('click', () => {
    importModal.classList.add('active');
    importTextarea.focus();
    importTextarea.classList.remove('textarea-error');
    updateImportPreview();
  });

  document.getElementById('btnCloseModal').addEventListener('click', () => importModal.classList.remove('active'));
  document.getElementById('btnCancelImport').addEventListener('click', () => importModal.classList.remove('active'));
  importModal.addEventListener('click', (e) => { if (e.target === importModal) importModal.classList.remove('active'); });

  importTextarea.addEventListener('input', () => {
    importTextarea.classList.remove('textarea-error');
    updateImportPreview();
  });

  // 确认导入
  document.getElementById('btnConfirmImport').addEventListener('click', async () => {
    const text = importTextarea.value;
    if (!text.trim()) {
      showToast('请输入邮箱信息', 'warning');
      importTextarea.classList.add('textarea-error');
      return;
    }

    const btn = document.getElementById('btnConfirmImport');
    setButtonLoading(btn, true);

    try {
      const res = await fetch('/api/accounts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();

      if (data.errors && data.errors.length > 0) {
        data.errors.forEach(err => showToast(err, 'error', 5000));
      }

      if (data.imported > 0) {
        importTextarea.value = '';
        updateImportPreview();
        importModal.classList.remove('active');
        showImportSuccessBanner(data.imported, data.duplicates);
        addLog(`导入 ${data.imported} 个邮箱 (重复 ${data.duplicates} 个)`, 'success');
        renderAccountList();
      } else if (data.duplicates > 0) {
        showToast(`所有 ${data.duplicates} 个邮箱都已存在`, 'warning');
      } else {
        showToast('未解析到有效的邮箱数据', 'warning');
        importTextarea.classList.add('textarea-error');
      }
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  });

  // Ctrl+Enter 快捷导入
  importTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnConfirmImport').click();
    }
  });

  // 搜索
  document.getElementById('accountSearch').addEventListener('input', () => renderAccountList());
  document.querySelectorAll('.account-group-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _accountGroupFilter = btn.dataset.accountGroup || 'all';
      renderAccountList();
    });
  });

  // 清空全部
  document.getElementById('btnClearAll').addEventListener('click', async () => {
    if (_cachedAccounts.length === 0) { showToast('没有可清空的邮箱', 'info'); return; }
    if (!confirm(`确定要清空全部 ${_cachedAccounts.length} 个邮箱吗？`)) return;

    document.querySelectorAll('.account-item').forEach(item => item.classList.add('account-item-removing'));
    setTimeout(async () => {
      await fetch('/api/accounts/clear', { method: 'DELETE' });
      renderAccountList();
      showToast('已清空全部邮箱', 'info');
      addLog('清空所有邮箱', 'warning');
    }, 300);
  });

  // 导出
  document.getElementById('btnExportAccounts').addEventListener('click', exportAccounts);
  document.getElementById('btnDiscoverAliases')?.addEventListener('click', discoverAliasesFromPlanEmails);

  // 邮件详情弹窗关闭
  const emailDetailModal = document.getElementById('emailDetailModal');
  document.getElementById('btnCloseDetail').addEventListener('click', () => emailDetailModal.classList.remove('active'));
  emailDetailModal.addEventListener('click', (e) => { if (e.target === emailDetailModal) emailDetailModal.classList.remove('active'); });
});
