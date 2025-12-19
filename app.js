// ============================================
// ГЛАВНАЯ ЛОГИКА ПРИЛОЖЕНИЯ
// ============================================

let currentUser = 'Сотрудник';

// Инициализация страницы
async function loadPage(pageName) {
  try {
    const mainContent = document.getElementById('main-content');
    
    // Подсветка активного пункта меню
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');

    // Загрузка содержимого страницы
    const response = await fetch(`/pages/${pageName}.html`);
    if (!response.ok) throw new Error(`Page not found: ${pageName}`);
    
    const html = await response.text();
    mainContent.innerHTML = html;

    // Выполнение скриптов после загрузки страницы
    const scripts = mainContent.querySelectorAll('script');
    scripts.forEach(script => {
      eval(script.textContent);
    });

  } catch (error) {
    console.error('Error loading page:', error);
    showNotification(`❌ Ошибка загрузки страницы: ${error.message}`, 'error');
  }
}

// Показать уведомление
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: ${
      type === 'success' ? '#28a745' :
      type === 'error' ? '#dc3545' :
      type === 'warning' ? '#ffc107' :
      '#667eea'
    };
    color: ${type === 'warning' ? '#333' : 'white'};
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 1000;
    max-width: 80%;
    animation: slideIn 0.3s ease;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Показать загрузку
function showLoading(show = true) {
  const spinner = document.getElementById('loading-spinner');
  if (show) {
    spinner.classList.remove('hidden');
  } else {
    spinner.classList.add('hidden');
  }
}

// Обновить статистику
async function updateStatistics() {
  try {
    const stats = await db.getStatistics();
    
    // Сохраняем в localStorage для дашборда
    localStorage.setItem('statistics', JSON.stringify(stats));
    
    // Обновляем дневной прогресс
    const today = new Date().toISOString().split('T');
    const dailyProgress = JSON.parse(localStorage.getItem('dailyProgress')) || [];
    const todayRecord = dailyProgress.find(d => d.date === today);
    
    if (todayRecord) {
      todayRecord.count = stats.sampledWells;
    } else {
      dailyProgress.push({ date: today, count: stats.sampledWells });
    }
    
    localStorage.setItem('dailyProgress', JSON.stringify(dailyProgress));
    
  } catch (error) {
    console.error('Error updating statistics:', error);
  }
}

// Форматирование даты
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Форматирование числа
function formatNumber(num) {
  return num.toLocaleString('ru-RU');
}

// Экспорт в Excel
async function exportToExcel() {
  try {
    showLoading(true);
    
    const wells = await db.getAllWells();
    const duplicates = await db.getAllDuplicates();
    
    // Подготовка данных
    const data = wells.map(well => ({
      'ID скважины': well.well_id,
      'Наименование': well.well_name,
      'X координата': well.x_coord,
      'Y координата': well.y_coord,
      'Z координата': well.z_coord,
      'Глубина': well.total_depth,
      'Статус': well.sampling_status === 'sampled' ? 'Опробована' : 'Не опробована',
      'Дата': well.sampled_at ? formatDate(well.sampled_at) : '',
      'Сотрудник': well.sampled_by || ''
    }));

    // Создание workbook
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Паспорт опробования');

    // Экспорт
    const fileName = `Паспорт_опробования_${new Date().toISOString().split('T')}.xlsx`;
    XLSX.writeFile(wb, fileName);

    showNotification('✓ Файл успешно экспортирован', 'success');
    
  } catch (error) {
    console.error('Export error:', error);
    showNotification(`❌ Ошибка экспорта: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// Импорт из Excel
async function importFromExcel(file) {
  try {
    showLoading(true);

    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = e.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames;
        const worksheet = workbook.Sheets[firstSheetName];
        
        const wellsData = XLSX.utils.sheet_to_json(worksheet);

        // Валидация данных
        const validWells = wellsData.filter(well => {
          return well['ID скважины'] && 
                 well['X координата'] !== undefined && 
                 well['Y координата'] !== undefined &&
                 well['Z координата'] !== undefined;
        }).map(well => ({
          well_id: String(well['ID скважины']).trim(),
          x_coord: parseFloat(well['X координата']),
          y_coord: parseFloat(well['Y координата']),
          z_coord: parseFloat(well['Z координата']),
          well_name: well['Наименование'] || `Скважина ${well['ID скважины']}`,
          total_depth: parseFloat(well['Глубина']) || 0
        }));

        if (validWells.length === 0) {
          throw new Error('В файле не найдены валидные скважины');
        }

        // Добавляем скважины в БД
        const added = await db.addWells(validWells);
        
        // Сохраняем в localStorage
        const allWells = await db.getAllWells();
        localStorage.setItem('wells', JSON.stringify(allWells));

        showNotification(`✓ Импортировано ${added} скважин`, 'success');
        await updateStatistics();

      } catch (error) {
        console.error('File processing error:', error);
        showNotification(`❌ Ошибка обработки файла: ${error.message}`, 'error');
      } finally {
        showLoading(false);
      }
    };

    reader.readAsBinaryString(file);

  } catch (error) {
    console.error('Import error:', error);
    showNotification(`❌ Ошибка импорта: ${error.message}`, 'error');
    showLoading(false);
  }
}

// Генерация дубликатов
async function generateDuplicates(ratio = '1:10') {
  try {
    showLoading(true);

    const wells = await db.getAllWells();
    const sampledWells = wells.filter(w => w.sampling_status === 'sampled');

    if (sampledWells.length === 0) {
      showNotification('⚠️ Нет опробованных скважин', 'warning');
      return;
    }

    const [num, denom] = ratio.split(':').map(Number);
    let duplicateCount = 0;

    for (let i = 0; i < sampledWells.length; i++) {
      if ((i + 1) % denom === 0) {
        const duplicate = {
          duplicate_id: `${sampledWells[i].well_id}_DUP_${Math.floor(i / denom) + 1}`,
          original_sample_id: sampledWells[i].well_id,
          duplicate_ratio: ratio,
          created_at: Date.now(),
          analysis_status: 'not_analyzed',
          synced: 0
        };

        await db.addDuplicate(duplicate);
        duplicateCount++;
      }
    }

    const allDuplicates = await db.getAllDuplicates();
    localStorage.setItem('duplicates', JSON.stringify(allDuplicates));

    showNotification(`✓ Создано ${duplicateCount} дубликатов`, 'success');

  } catch (error) {
    console.error('Duplicate generation error:', error);
    showNotification(`❌ Ошибка генерации дубликатов: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// Навигация
document.addEventListener('click', (e) => {
  const navItem = e.target.closest('.nav-item');
  if (navItem) {
    e.preventDefault();
    const page = navItem.dataset.page;
    if (page) {
      loadPage(page);
    }
  }
});

console.log('App initialized');
