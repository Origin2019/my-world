// ===== 数据持久化 & 云同步见 sync.js（在 index.html 中先于本文件加载）=====
// 本文件只负责界面逻辑，数据的读写仍然走 localStorage。

var dataVersion = localStorage.getItem('data_version');
if (dataVersion !== '3') {
    // 网页版首次运行：不加载本机的 data.json（那是个人隐私数据，不会上传到公网）。
    // 需要预置课程表等初始内容时，直接改下面的 defaultCourses。
    localStorage.setItem('data_version', '3');
}

let todos = JSON.parse(localStorage.getItem('todos')) || [];
// 已停止每日自动生成“写666件事”，顺带清掉历史遗留的自动生成记录（手动添加的不受影响）
var cleaned666 = todos.filter(function(t) { return !(t.text === '写666件事' && t.autoDate); });
if (cleaned666.length !== todos.length) {
    todos = cleaned666;
    localStorage.setItem('todos', JSON.stringify(todos));
}
let ddls = JSON.parse(localStorage.getItem('ddls')) || [];
let resources = JSON.parse(localStorage.getItem('resources')) || [];

var savedCourses = localStorage.getItem('courses');
var defaultCourses = [
    { id: 1, week: '1-20', day: '3', startSlot: 1, endSlot: 3, name: '编译原理' },
    { id: 2, week: '1-20', day: '4', startSlot: 1, endSlot: 3, name: '需求与商业模式创新' },
    { id: 3, week: '1-20', day: '0', startSlot: 4, endSlot: 6, name: '移动互联网应用开发' },
    { id: 4, week: '1-20', day: '3', startSlot: 4, endSlot: 6, name: '机器学习' },
    { id: 5, week: '1-20', day: '4', startSlot: 4, endSlot: 6, name: '大模型系统与工程' },
    { id: 6, week: '1-20', day: '0', startSlot: 8, endSlot: 9, name: '形势与政策' }
];

if (savedCourses) {
    courses = JSON.parse(savedCourses);
} else {
    courses = defaultCourses;
    localStorage.setItem('courses', JSON.stringify(courses));
}

let editingCourseId = null;
let editingScheduleId = null;

var savedSchedules = localStorage.getItem('schedules');
var schedules = [];
if (savedSchedules) {
    try { schedules = JSON.parse(savedSchedules); } catch (e) { schedules = []; }
}
if (!Array.isArray(schedules)) schedules = [];

var hoverViewDate = null;
var hoverViewDay = null;
var scheduleAreaHovered = false;

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_COUNT = DAYS.length;

const TIME_SLOTS = [
  { time: '08:00-08:50', category: 'morning', session: 1 },
  { time: '09:00-09:50', category: 'morning', session: 2 },
  { time: '10:10-11:00', category: 'morning', session: 3 },
  { time: '11:10-12:00', category: 'morning', session: 4 },
  { time: '14:00-14:50', category: 'afternoon', session: 5 },
  { time: '15:00-15:50', category: 'afternoon', session: 6 },
  { time: '16:10-17:00', category: 'afternoon', session: 7 },
  { time: '17:10-18:00', category: 'afternoon', session: 8 },
  { time: '18:30-19:20', category: 'evening', session: 9 },
  { time: '19:30-20:20', category: 'evening', session: 10 },
  { time: '20:30-21:20', category: 'evening', session: 11 },
  { time: '21:30-22:20', category: 'evening', session: 12 }
];

const COURSE_COLORS = [
    { bg: '#e0f7fa', border: '#b2ebf2', text: '#006064' },
    { bg: '#f3e5f5', border: '#ce93d8', text: '#4a148c' },
    { bg: '#e8f5e9', border: '#a5d6a7', text: '#1b5e20' },
    { bg: '#fff3e0', border: '#ffcc80', text: '#e65100' },
    { bg: '#e3f2fd', border: '#90caf9', text: '#0d47a1' },
    { bg: '#fce4ec', border: '#f48fb1', text: '#b71c1c' },
    { bg: '#f1f8e9', border: '#c5e1a5', text: '#33691e' },
    { bg: '#ede7f6', border: '#b39ddb', text: '#311b92' },
    { bg: '#e0f2f1', border: '#80cbc4', text: '#004d40' },
    { bg: '#fff8e1', border: '#ffe082', text: '#f57f17' }
];

function darkenHex(hex, ratio) {
    var num = parseInt(hex.slice(1), 16);
    var r = Math.round(((num >> 16) & 255) * (1 - ratio));
    var g = Math.round(((num >> 8) & 255) * (1 - ratio));
    var b = Math.round((num & 255) * (1 - ratio));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function invertColorOf(color) {
    return { bg: color.text, border: darkenHex(color.text, 0.3), text: color.bg };
}

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekContains(weekStr, targetWeek) {
    if (!weekStr) return false;
    var segments = weekStr.split(',');
    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i].trim();
        var range = seg.split('-');
        if (range.length === 2) {
            var start = parseInt(range[0]);
            var end = parseInt(range[1]);
            if (targetWeek >= start && targetWeek <= end) return true;
        } else {
            if (parseInt(seg) === targetWeek) return true;
        }
    }
    return false;
}

function getCourseByCell(week, day, slot) {
    return courses.find(function(c) {
        return weekContains(c.week, week) && c.day === String(day) && parseInt(c.startSlot) <= slot && parseInt(c.endSlot) >= slot;
    });
}

function getCourseColor(courseId) {
    var index = courses.findIndex(function(c) { return c.id === courseId; });
    return COURSE_COLORS[index % COURSE_COLORS.length];
}

function getSemesterStart() {
    return new Date(2026, 7, 24);
}

function dateForWeekDay(week, day) {
    var d = getSemesterStart();
    d.setDate(d.getDate() + (parseInt(week, 10) - 1) * 7 + day);
    return d;
}

function dateKey(d) {
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function shortDateKey(d) {
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function weekdayOfKey(key) {
    var parts = String(key).split('-');
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return WEEK_NAMES[d.getDay()];
}

function getScheduleByCell(dateStr, slot) {
    return schedules.find(function(s) {
        return s.date === dateStr && parseInt(s.startSlot) <= slot && parseInt(s.endSlot) >= slot;
    });
}

function getScheduleColor(scheduleId) {
    var schedule = schedules.find(function(s) { return s.id === scheduleId; });
    var index = -1;
    if (schedule) {
        var sName = String(schedule.name || '').trim();
        index = courses.findIndex(function(c) { return String(c.name || '').trim() === sName; });
    }
    if (index < 0) index = schedules.findIndex(function(s) { return s.id === scheduleId; });
    if (index < 0) index = 0;
    return invertColorOf(COURSE_COLORS[index % COURSE_COLORS.length]);
}

function updateDayHeaderDates(week, hovered) {
    for (var day = 0; day < DAY_COUNT; day++) {
        var th = document.querySelector('.schedule-grid th[data-day="' + day + '"]');
        if (!th) continue;
        var span = th.querySelector('.day-date');
        if (span) span.textContent = shortDateKey(dateForWeekDay(week, day));
        if (hovered) {
            th.classList.add('day-hover');
        } else {
            th.classList.remove('day-hover');
        }
    }
}

// ===== 课表等比缩放 =====
// 以 660px 为设计基准宽度，按容器宽度对整张表做等比缩放（zoom），
// 宽度和高度同比例变化 —— 任何屏幕比例下都填满右栏且绝不横向拉伸。
var SCHEDULE_BASE_WIDTH = 660;
function fitSchedule() {
    var wrapper = document.querySelector('.schedule-grid-wrapper');
    var table = document.getElementById('scheduleGrid');
    if (!wrapper || !table) return;
    var avail = wrapper.clientWidth;
    if (avail <= 0) return; // 页签隐藏时跳过
    var k = (avail - 1) / SCHEDULE_BASE_WIDTH; // 留 1px 余量，防止取整导致表格横向溢出1像素
    // 手机等窄屏：缩得太小字就看不清了，改成保持原尺寸 + 横向滚动
    if (k < 0.72) {
        if (table.style.zoom) table.style.zoom = '';
        return;
    }
    var cur = parseFloat(table.style.zoom) || 1;
    // 变化小于 0.5% 不动，防止滚动条出现/消失引起反复抖动
    if (Math.abs(cur - k) < 0.005) return;
    table.style.zoom = k;
}

function renderScheduleGrid() {
    var weekSelect = document.getElementById('weekSelect');
    var currentWeek = parseInt(weekSelect.value);
    var tbody = document.getElementById('scheduleBody');
    var viewDate = hoverViewDate;

    updateDayHeaderDates(currentWeek, viewDate !== null);

    var html = '';
    var lastCategory = '';

    for (var slot = 0; slot < TIME_SLOTS.length; slot++) {
        var slotInfo = TIME_SLOTS[slot];
        if (slotInfo.category !== lastCategory) {
            var categoryText = slotInfo.category === 'morning' ? '上午' :
                               slotInfo.category === 'afternoon' ? '下午' : '晚上';
            html += '<tr class="category-row"><td colspan="' + (DAY_COUNT + 1) + '" class="category-header">' + categoryText + '</td></tr>';
            lastCategory = slotInfo.category;
        }
        html += '<tr class="session-row"><th class="time-header">' + slotInfo.session + '</th>';
        for (var day = 0; day < DAY_COUNT; day++) {
            var course = null;
            var schedule = null;
            if (viewDate) {
                if (day === hoverViewDay) schedule = getScheduleByCell(viewDate, slot);
            } else {
                course = getCourseByCell(currentWeek, day, slot);
            }
            if (schedule) {
                var sColor = getScheduleColor(schedule.id);
                html += '<td class="has-schedule-cell" style="background:' + sColor.bg + ';border-color:' + sColor.border + ';" ' +
                    'data-schedule-id="' + schedule.id + '" oncontextmenu="onScheduleRightClick(event,' + schedule.id + ')">' +
                    '<div class="schedule-cell-text" style="color:' + sColor.text + ';">' + schedule.name + '</div></td>';
            } else if (course) {
                var color = getCourseColor(course.id);
                html += '<td class="has-course-cell" style="background:' + color.bg + ';border-color:' + color.border + ';" ' +
                    'data-course-id="' + course.id + '" oncontextmenu="onCourseRightClick(event,' + course.id + ')">' +
                    '<div class="course-cell-text" style="color:' + color.text + ';">' + course.name + '</div></td>';
            } else if (viewDate && day !== hoverViewDay) {
                html += '<td class="dim-cell"></td>';
            } else {
                html += '<td></td>';
            }
        }
        html += '</tr>';
    }
    tbody.innerHTML = html;
    fitSchedule();
}

function onDayHeaderEnter(day) {
    var weekSelect = document.getElementById('weekSelect');
    var week = parseInt(weekSelect.value, 10);
    hoverViewDay = day;
    hoverViewDate = dateKey(dateForWeekDay(week, day));
    renderScheduleGrid();
}

function resetScheduleView() {
    if (hoverViewDate === null) return;
    hoverViewDate = null;
    hoverViewDay = null;
    renderScheduleGrid();
}

function initScheduleHover() {
    var wrapper = document.querySelector('.schedule-grid-wrapper');
    if (!wrapper) return;
    var headers = document.querySelectorAll('.schedule-grid th[data-day]');
    headers.forEach(function(th) {
        th.addEventListener('mouseenter', function() {
            onDayHeaderEnter(parseInt(th.getAttribute('data-day'), 10));
        });
    });
    wrapper.addEventListener('mouseenter', function() { scheduleAreaHovered = true; });
    wrapper.addEventListener('mouseleave', function() {
        scheduleAreaHovered = false;
        if (document.getElementById('contextMenu')) return;
        resetScheduleView();
    });
}

function onCourseRightClick(e, courseId) {
    e.preventDefault();
    var course = courses.find(function(c) { return c.id === courseId; });
    if (!course) return;

    var existingMenu = document.getElementById('contextMenu');
    if (existingMenu) existingMenu.remove();

    var menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.innerHTML =
        '<div class="context-menu-title">' + course.name + '</div>' +
        '<div class="context-menu-item" onclick="openEditCourseModal(' + course.id + ')">编辑课程</div>' +
        '<div class="context-menu-item context-menu-delete" onclick="deleteCourseById(' + course.id + ')">删除课程</div>';
    document.body.appendChild(menu);

    function closeMenu() {
        var m = document.getElementById('contextMenu');
        if (m) m.remove();
        document.removeEventListener('click', closeMenu);
    }
    setTimeout(function() {
        document.addEventListener('click', closeMenu);
    }, 10);
}

function openEditCourseModal(courseId) {
    var course = courses.find(function(c) { return c.id === courseId; });
    if (!course) return;
    editingCourseId = courseId;

    var selectedWeeks = parseWeekStr(course.week);

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeCellModal(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>修改课程</h3>' +
        '<div class="modal-input-row"><label>课程名称</label>' +
        '<input type="text" id="modalCourseName" value="' + course.name + '"></div>' +
        '<div class="modal-input-row"><label>星期</label>' +
        '<select id="modalCourseDay">' +
        DAYS.map(function(d, i) { return '<option value="' + i + '"' + (parseInt(course.day) === i ? ' selected' : '') + '>' + d + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="modal-input-row"><label>开始节次</label>' +
        '<select id="modalStartTime">' +
        TIME_SLOTS.map(function(t, i) { return '<option value="' + i + '"' + (i === parseInt(course.startSlot) ? ' selected' : '') + '>第' + t.session + '节</option>'; }).join('') +
        '</select></div>' +
        '<div class="modal-input-row"><label>结束节次</label>' +
        '<select id="modalEndTime">' +
        TIME_SLOTS.map(function(t, i) { return '<option value="' + i + '"' + (i === parseInt(course.endSlot) ? ' selected' : '') + '>第' + t.session + '节</option>'; }).join('') +
        '</select></div>' +
        '<div class="modal-input-row"><label>周数</label>' +
        '<div class="week-buttons" id="weekButtons">' + renderWeekButtons(selectedWeeks) + '</div>' +
        '</div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="closeCellModal()">取消</button>' +
        '<button class="confirm-btn" onclick="saveEditCourse()">保存</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() { document.getElementById('modalCourseName').focus(); }, 100);
}

function openAddCourseModal() {
    editingCourseId = null;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeCellModal(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>添加课程</h3>' +
        '<div class="modal-input-row"><label>课程名称</label>' +
        '<input type="text" id="modalCourseName" placeholder="输入课程名称..."></div>' +
        '<div class="modal-input-row"><label>星期</label>' +
        '<select id="modalCourseDay">' +
        DAYS.map(function(d, i) { return '<option value="' + i + '">' + d + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="modal-input-row"><label>开始节次</label>' +
        '<select id="modalStartTime">' +
        TIME_SLOTS.map(function(t, i) { return '<option value="' + i + '">第' + t.session + '节</option>'; }).join('') +
        '</select></div>' +
        '<div class="modal-input-row"><label>结束节次</label>' +
        '<select id="modalEndTime">' +
        TIME_SLOTS.map(function(t, i) { return '<option value="' + i + '">第' + t.session + '节</option>'; }).join('') +
        '</select></div>' +
        '<div class="modal-input-row"><label>周数</label>' +
        '<div class="week-buttons" id="weekButtons">' + renderWeekButtons([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]) + '</div>' +
        '</div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="closeCellModal()">取消</button>' +
        '<button class="confirm-btn" onclick="saveAddCourse()">确认添加</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() { document.getElementById('modalCourseName').focus(); }, 100);
}

function closeCellModal() {
    var overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.remove();
    editingCourseId = null;
    editingScheduleId = null;
}

function parseWeekStr(weekStr) {
    if (!weekStr) return [];
    var result = [];
    var parts = weekStr.split(',');
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        var range = p.split('-');
        if (range.length === 2) {
            var s = parseInt(range[0]);
            var e = parseInt(range[1]);
            for (var w = s; w <= e; w++) result.push(w);
        } else {
            var num = parseInt(p);
            if (!isNaN(num)) result.push(num);
        }
    }
    return result;
}

function weeksToStr(arr) {
    if (!arr || arr.length === 0) return '';
    arr.sort(function(a, b) { return a - b; });
    var ranges = [];
    var start = arr[0], end = arr[0];
    for (var i = 1; i < arr.length; i++) {
        if (arr[i] === end + 1) {
            end = arr[i];
        } else {
            ranges.push(start === end ? String(start) : start + '-' + end);
            start = arr[i];
            end = arr[i];
        }
    }
    ranges.push(start === end ? String(start) : start + '-' + end);
    return ranges.join(',');
}

function renderWeekButtons(selectedWeeks) {
    var html = '';
    for (var w = 1; w <= 20; w++) {
        var isActive = selectedWeeks.indexOf(w) !== -1;
        html += '<button type="button" class="week-btn' + (isActive ? ' active' : '') + '" onclick="toggleWeek(this,' + w + ')">' + w + '</button>';
    }
    return html;
}

function toggleWeek(btn, week) {
    btn.classList.toggle('active');
}

function getSelectedWeeks() {
    var btns = document.querySelectorAll('#weekButtons .week-btn.active');
    var arr = [];
    btns.forEach(function(b) { arr.push(parseInt(b.textContent)); });
    return arr;
}

function saveAddCourse() {
    var name = document.getElementById('modalCourseName').value.trim();
    var day = document.getElementById('modalCourseDay').value;
    var startSlot = parseInt(document.getElementById('modalStartTime').value);
    var endSlot = parseInt(document.getElementById('modalEndTime').value);
    var selectedWeeks = getSelectedWeeks();

    if (!name) { alert('请输入课程名称'); return; }
    if (isNaN(startSlot) || isNaN(endSlot)) { alert('请选择时间'); return; }
    if (startSlot > endSlot) { alert('结束时间不能早于开始时间'); return; }
    if (selectedWeeks.length === 0) { alert('请选择周数'); return; }

    courses.push({
        id: Date.now(),
        week: weeksToStr(selectedWeeks),
        day: String(day),
        startSlot: startSlot,
        endSlot: endSlot,
        name: name
    });
    localStorage.setItem('courses', JSON.stringify(courses));
    closeCellModal();
    renderScheduleGrid();
}

function saveEditCourse() {
    if (!editingCourseId) return;
    var courseIndex = courses.findIndex(function(c) { return c.id === editingCourseId; });
    if (courseIndex === -1) return;

    var name = document.getElementById('modalCourseName').value.trim();
    var day = document.getElementById('modalCourseDay').value;
    var startSlot = parseInt(document.getElementById('modalStartTime').value);
    var endSlot = parseInt(document.getElementById('modalEndTime').value);
    var selectedWeeks = getSelectedWeeks();

    if (!name) { alert('请输入课程名称'); return; }
    if (startSlot > endSlot) { alert('结束时间不能早于开始时间'); return; }
    if (selectedWeeks.length === 0) { alert('请选择周数'); return; }

    courses[courseIndex].name = name;
    courses[courseIndex].day = String(day);
    courses[courseIndex].startSlot = startSlot;
    courses[courseIndex].endSlot = endSlot;
    courses[courseIndex].week = weeksToStr(selectedWeeks);
    localStorage.setItem('courses', JSON.stringify(courses));
    closeCellModal();
    renderScheduleGrid();
}

function deleteCourseById(courseId) {
    if (confirm('确定要删除这门课程吗？')) {
        courses = courses.filter(function(c) { return c.id !== courseId; });
        localStorage.setItem('courses', JSON.stringify(courses));
        renderScheduleGrid();
    }
}

function slotSelectHtml(part, selected) {
    return TIME_SLOTS.map(function(t, i) {
        var label = t.time.split('-')[part === 'end' ? 1 : 0];
        var sel = (selected !== undefined && selected !== null && i === selected) ? ' selected' : '';
        return '<option value="' + i + '"' + sel + '>' + label + '</option>';
    }).join('');
}

function updateScheduleWeekday() {
    var dateEl = document.getElementById('modalScheduleDate');
    var span = document.getElementById('modalScheduleWeekday');
    if (!dateEl || !span) return;
    if (!dateEl.value) { span.textContent = ''; return; }
    span.textContent = weekdayOfKey(dateEl.value);
}

function openAddScheduleModal(prefillName) {
    editingScheduleId = null;
    var defaultDate = todayDate();
    var safeName = prefillName ? String(prefillName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeCellModal(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>添加日程</h3>' +
        '<div class="modal-input-row"><label>日程名称</label>' +
        '<input type="text" id="modalScheduleName" placeholder="输入日程名称..." value="' + safeName + '"></div>' +
        '<div class="modal-input-row"><label>日期</label>' +
        '<div class="date-row"><input type="date" id="modalScheduleDate" value="' + defaultDate + '">' +
        '<span class="date-weekday" id="modalScheduleWeekday"></span></div></div>' +
        '<div class="modal-input-row"><label>开始时间</label>' +
        '<select id="modalStartTime">' + slotSelectHtml('start') + '</select></div>' +
        '<div class="modal-input-row"><label>结束时间</label>' +
        '<select id="modalEndTime">' + slotSelectHtml('end') + '</select></div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="closeCellModal()">取消</button>' +
        '<button class="confirm-btn" onclick="saveAddSchedule()">确认添加</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() {
        var nameEl = document.getElementById('modalScheduleName');
        if (nameEl) nameEl.focus();
        var dateEl = document.getElementById('modalScheduleDate');
        if (dateEl) {
            updateScheduleWeekday();
            dateEl.addEventListener('change', updateScheduleWeekday);
            dateEl.addEventListener('input', updateScheduleWeekday);
        }
    }, 100);
}

function saveAddSchedule() {
    var name = document.getElementById('modalScheduleName').value.trim();
    var date = document.getElementById('modalScheduleDate').value;
    var startSlot = parseInt(document.getElementById('modalStartTime').value);
    var endSlot = parseInt(document.getElementById('modalEndTime').value);

    if (!name) { alert('请输入日程名称'); return; }
    if (!date) { alert('请选择日期'); return; }
    if (isNaN(startSlot) || isNaN(endSlot)) { alert('请选择时间'); return; }
    if (startSlot > endSlot) { alert('结束时间不能早于开始时间'); return; }

    schedules.push({
        id: Date.now(),
        date: date,
        startSlot: startSlot,
        endSlot: endSlot,
        name: name
    });
    localStorage.setItem('schedules', JSON.stringify(schedules));
    closeCellModal();
    renderScheduleGrid();
}

function openEditScheduleModal(scheduleId) {
    var schedule = schedules.find(function(s) { return s.id === scheduleId; });
    if (!schedule) return;
    editingScheduleId = scheduleId;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeCellModal(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>修改日程</h3>' +
        '<div class="modal-input-row"><label>日程名称</label>' +
        '<input type="text" id="modalScheduleName" value="' + schedule.name.replace(/"/g, '&quot;') + '"></div>' +
        '<div class="modal-input-row"><label>日期</label>' +
        '<div class="date-row"><input type="date" id="modalScheduleDate" value="' + schedule.date + '">' +
        '<span class="date-weekday" id="modalScheduleWeekday"></span></div></div>' +
        '<div class="modal-input-row"><label>开始时间</label>' +
        '<select id="modalStartTime">' + slotSelectHtml('start', parseInt(schedule.startSlot)) + '</select></div>' +
        '<div class="modal-input-row"><label>结束时间</label>' +
        '<select id="modalEndTime">' + slotSelectHtml('end', parseInt(schedule.endSlot)) + '</select></div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="closeCellModal()">取消</button>' +
        '<button class="confirm-btn" onclick="saveEditSchedule()">保存</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() {
        var nameEl = document.getElementById('modalScheduleName');
        if (nameEl) nameEl.focus();
        var dateEl = document.getElementById('modalScheduleDate');
        if (dateEl) {
            updateScheduleWeekday();
            dateEl.addEventListener('change', updateScheduleWeekday);
            dateEl.addEventListener('input', updateScheduleWeekday);
        }
    }, 100);
}

function saveEditSchedule() {
    if (!editingScheduleId) return;
    var index = schedules.findIndex(function(s) { return s.id === editingScheduleId; });
    if (index === -1) return;

    var name = document.getElementById('modalScheduleName').value.trim();
    var date = document.getElementById('modalScheduleDate').value;
    var startSlot = parseInt(document.getElementById('modalStartTime').value);
    var endSlot = parseInt(document.getElementById('modalEndTime').value);

    if (!name) { alert('请输入日程名称'); return; }
    if (!date) { alert('请选择日期'); return; }
    if (startSlot > endSlot) { alert('结束时间不能早于开始时间'); return; }

    schedules[index].name = name;
    schedules[index].date = date;
    schedules[index].startSlot = startSlot;
    schedules[index].endSlot = endSlot;
    localStorage.setItem('schedules', JSON.stringify(schedules));
    closeCellModal();
    renderScheduleGrid();
}

function deleteScheduleById(scheduleId) {
    if (confirm('确定要删除这条日程吗？')) {
        schedules = schedules.filter(function(s) { return s.id !== scheduleId; });
        localStorage.setItem('schedules', JSON.stringify(schedules));
        renderScheduleGrid();
    }
}

function onScheduleRightClick(e, scheduleId) {
    e.preventDefault();
    var schedule = schedules.find(function(s) { return s.id === scheduleId; });
    if (!schedule) return;

    var existingMenu = document.getElementById('contextMenu');
    if (existingMenu) existingMenu.remove();

    var menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.innerHTML =
        '<div class="context-menu-title">' + schedule.name + '<br><span style="font-weight:normal;color:#718096;">' +
        schedule.date + ' ' + weekdayOfKey(schedule.date) + '</span></div>' +
        '<div class="context-menu-item" onclick="openEditScheduleModal(' + schedule.id + ')">编辑日程</div>' +
        '<div class="context-menu-item context-menu-delete" onclick="deleteScheduleById(' + schedule.id + ')">删除日程</div>';
    document.body.appendChild(menu);

    function closeMenu() {
        var m = document.getElementById('contextMenu');
        if (m) m.remove();
        document.removeEventListener('click', closeMenu);
        if (!scheduleAreaHovered) resetScheduleView();
    }
    setTimeout(function() {
        document.addEventListener('click', closeMenu);
    }, 10);
}

function renderTodos() {
    var todoList = document.getElementById('todoItems');
    var visible = todos.filter(function(t) { return !t.hidden; });
    if (visible.length === 0) { todoList.innerHTML = '<div class="empty-message">暂无待办事项</div>'; renderFloating(); return; }
    var html = '';
    for (var i = 0; i < todos.length; i++) {
        if (todos[i].hidden) continue;
        var checked = todos[i].completed ? ' checked' : '';
        var doneClass = todos[i].completed ? ' done' : '';
        html += '<li class="todo-item' + doneClass + '" oncontextmenu="onTodoRightClick(event,' + i + ')">';
        html += '<label class="todo-check"><input type="checkbox"' + checked + ' onchange="toggleTodo(' + i + ')"><span class="checkmark"></span></label>';
        html += '<span>' + todos[i].text + '</span>';
        if (todos[i].hasProgress && todos[i].subTasks) {
            var completed = getCompletedCount(todos[i].subTasks);
            var total = todos[i].subTasks.length;
            var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
            html += '<div class="todo-progress-wrap">';
            html += '<span class="todo-progress-text">' + completed + '/' + total + '</span>';
            html += '<div class="todo-progress-bar"><div class="todo-progress-fill" style="width:' + pct + '%"></div></div>';
            html += '<span class="todo-progress-pct">' + pct + '%</span>';
            html += '<button class="todo-expand-btn' + (todos[i].expanded ? ' open' : '') + '" onclick="toggleExpand(' + i + ')">&#9662;</button>';
            html += '<button class="todo-float-btn" onclick="openFloating(' + i + ')" title="固定为悬浮窗，始终显示在最上层">&#128204;</button>';
            html += '</div>';
        }
        html += '</li>';
        if (todos[i].hasProgress && todos[i].subTasks && todos[i].expanded) {
            var cols = todos[i].subTasks.length <= 10 ? 5 : (todos[i].subTasks.length <= 20 ? 6 : 7);
            html += '<li class="todo-subtask-panel">';
            html += '<div class="todo-subtask-grid" style="grid-template-columns: repeat(' + cols + ', 1fr);">';
            for (var j = 0; j < todos[i].subTasks.length; j++) {
                var subChecked = todos[i].subTasks[j] ? ' checked' : '';
                html += '<label class="todo-subtask-item">';
                html += '<input type="checkbox"' + subChecked + ' onchange="toggleSubTask(' + i + ',' + j + ')">';
                html += '<span class="subtask-checkmark"></span>';
                html += '<span class="subtask-label">' + (j + 1) + '</span>';
                html += '</label>';
            }
            html += '</div>';
            var comp2 = getCompletedCount(todos[i].subTasks);
            var tot2 = todos[i].subTasks.length;
            html += '<div class="todo-subtask-summary">' + comp2 + '/' + tot2 + ' 完成</div>';
            html += '</li>';
        }
    }
    todoList.innerHTML = html;
    renderFloating();   // 悬浮窗跟着一起更新
}

function addTodo() {
    var input = document.getElementById('todoInput');
    var text = input.value.trim();
    if (text === '') { alert('请输入待办事项内容'); return; }
    var hasProgress = document.getElementById('todoHasProgress').checked;
    var todo = { text: text, createdAt: new Date().toISOString(), completed: false, actionDate: getTodayStr() };
    if (hasProgress) {
        var count = parseInt(document.getElementById('todoSubtaskCount').value) || 3;
        if (count < 1) count = 1;
        if (count > 100) count = 100;
        todo.hasProgress = true;
        todo.subTasks = [];
        for (var k = 0; k < count; k++) { todo.subTasks.push(false); }
        todo.expanded = false;
    }
    todos.push(todo);
    localStorage.setItem('todos', JSON.stringify(todos));
    input.value = '';
    document.getElementById('todoHasProgress').checked = false;
    document.getElementById('subtaskCountWrapper').style.display = 'none';
    renderTodos();
}

function openEditTodoModal(index) {
    var todo = todos[index];
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>编辑待办</h3>' +
        '<div class="modal-input-row"><label>待办内容</label>' +
        '<input type="text" id="editTodoText" value="' + todo.text.replace(/"/g, '&quot;') + '"></div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
        '<button class="confirm-btn" onclick="saveEditTodo(' + index + ', this)">保存</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() { document.getElementById('editTodoText').focus(); }, 100);
}

function saveEditTodo(index, btn) {
    var overlay = btn.closest('.modal-overlay');
    var text = document.getElementById('editTodoText').value.trim();
    if (!text) { alert('请输入待办内容'); return; }
    todos[index].text = text;
    localStorage.setItem('todos', JSON.stringify(todos));
    overlay.remove();
    renderTodos();
}

function deleteTodo(index) {
    var todo = todos[index];
    // 手动删除自动待办时记入忽略名单，避免当天被定时器重新生成
    if (todo && todo.autoDate) {
        dismissAutoTodo(todo.text);
    }
    todos.splice(index, 1);
    localStorage.setItem('todos', JSON.stringify(todos));
    renderTodos();
}

function addProgressBarToTodo(index) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>添加进度条</h3>' +
        '<div class="modal-input-row"><label>子任务数量（1-100）</label>' +
        '<input type="number" id="promptSubtaskCount" min="1" max="100" value="3"></div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
        '<button class="confirm-btn" onclick="confirmAddProgressBar(' + index + ', this)">确认</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() { document.getElementById('promptSubtaskCount').focus(); }, 100);
}

function confirmAddProgressBar(index, btn) {
    var overlay = btn.closest('.modal-overlay');
    var count = parseInt(document.getElementById('promptSubtaskCount').value) || 3;
    if (count < 1) count = 1;
    if (count > 100) count = 100;

    todos[index].hasProgress = true;
    todos[index].subTasks = [];
    for (var k = 0; k < count; k++) {
        todos[index].subTasks.push(false);
    }
    todos[index].expanded = false;

    localStorage.setItem('todos', JSON.stringify(todos));
    renderTodos();
    overlay.remove();
}

function toggleTodo(index) {
    todos[index].completed = !todos[index].completed;
    if (todos[index].hasProgress && todos[index].subTasks) {
        var all = !todos[index].completed;
        for (var k = 0; k < todos[index].subTasks.length; k++) {
            todos[index].subTasks[k] = all;
        }
    }
    localStorage.setItem('todos', JSON.stringify(todos));
    renderTodos();
}

function getCompletedCount(subTasks) {
    var c = 0;
    for (var k = 0; k < subTasks.length; k++) { if (subTasks[k]) c++; }
    return c;
}

function toggleSubTask(todoIdx, subIdx) {
    todos[todoIdx].subTasks[subIdx] = !todos[todoIdx].subTasks[subIdx];
    var completed = getCompletedCount(todos[todoIdx].subTasks);
    var total = todos[todoIdx].subTasks.length;
    if (completed === total) {
        todos[todoIdx].completed = true;
    } else {
        todos[todoIdx].completed = false;
    }
    localStorage.setItem('todos', JSON.stringify(todos));
    renderTodos();
}

function toggleExpand(index) {
    todos[index].expanded = !todos[index].expanded;
    localStorage.setItem('todos', JSON.stringify(todos));
    renderTodos();
}

function openFloating(index) {
    var t = todos[index];
    if (!t) return;
    if (!t.hasProgress || !t.subTasks) {
        alert('只有带进度条的待办才能固定到悬浮窗（右键 → 添加进度条）');
        return;
    }
    var key = todoKeyOf(t);
    var keys = getFloatingKeys();
    if (keys.indexOf(key) < 0) { keys.push(key); setFloatingKeys(keys); }
    localStorage.removeItem(FLOAT_MIN_KEY);   // 固定时自动展开
    renderFloating();
}

/* ================= 悬浮待办（网页版：固定在页面最上层的浮层） ================= */
var FLOAT_KEY = '__floating_todos';
var FLOAT_POS_KEY = '__floating_pos';
var FLOAT_MIN_KEY = '__floating_min';

function getFloatingKeys() {
    try {
        var v = JSON.parse(localStorage.getItem(FLOAT_KEY));
        return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
}
function setFloatingKeys(keys) {
    localStorage.setItem(FLOAT_KEY, JSON.stringify(keys));
}
function todoKeyOf(t) {
    return String(t.createdAt || t.text || '');
}
function findTodoByKey(key) {
    for (var i = 0; i < todos.length; i++) {
        if (todoKeyOf(todos[i]) === key) return i;
    }
    return -1;
}

function unpinFloatingAt(i) {
    var keys = getFloatingKeys();
    keys.splice(i, 1);
    setFloatingKeys(keys);
    renderFloating();
}

function closeFloatingPanel() {
    setFloatingKeys([]);
    renderFloating();
}

function toggleFloatingMin() {
    var panel = document.getElementById('floatingPanel');
    if (!panel) return;
    var min = panel.classList.toggle('floating-min');
    if (min) localStorage.setItem(FLOAT_MIN_KEY, '1');
    else localStorage.removeItem(FLOAT_MIN_KEY);
}

function floatToggleSub(keyIdx, subIdx) {
    var keys = getFloatingKeys();
    var ti = findTodoByKey(keys[keyIdx]);
    if (ti < 0) return;
    toggleSubTask(ti, subIdx);
}

function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function applyFloatingPos(panel) {
    var pos = null;
    try { pos = JSON.parse(localStorage.getItem(FLOAT_POS_KEY)); } catch (e) { }
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        panel.style.left = clampNum(pos.left, 0, Math.max(0, window.innerWidth - 80)) + 'px';
        panel.style.top = clampNum(pos.top, 0, Math.max(0, window.innerHeight - 60)) + 'px';
        panel.style.right = 'auto';
    } else {
        panel.style.left = 'auto';
        panel.style.right = '14px';
        panel.style.top = '86px';
    }
}

function ensureFloatingPanel() {
    // 兜底：浏览器缓存了旧版 index.html（页面里没有面板节点）时，动态把面板建出来，
    // 避免出现「点了 📌 却毫无反应」（待办其实已固定，只是没有可见的面板）。
    var panel = document.getElementById('floatingPanel');
    if (panel && document.getElementById('floatingBody') && document.getElementById('floatingHeader')) return panel;
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'floatingPanel';
    panel.className = 'floating-panel';
    // 关键样式写在行内：即使 style.css 也是旧版，浮层也能正常显示在最上层
    panel.style.cssText = 'position:fixed;right:14px;top:86px;width:260px;max-width:88vw;' +
        'max-height:70vh;overflow:hidden;display:none;flex-direction:column;background:#fff;' +
        'border:1px solid #D4C4B0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.18);' +
        'z-index:99999;font-size:0.8rem;';
    panel.innerHTML =
        '<div class="floating-header" id="floatingHeader" style="display:flex;align-items:center;' +
            'gap:6px;padding:6px 8px;background:#7CB342;color:#fff;font-weight:bold;">' +
            '<span class="floating-header-title" style="flex:1;">📌 悬浮待办</span>' +
            '<button class="floating-pip-btn" id="floatingPipBtn" onclick="toggleFloatingPip()" ' +
                'title="独立置顶小窗：可浮在记事本等任意窗口之上" style="display:none;">🪟</button>' +
            '<button class="floating-min-btn" onclick="toggleFloatingMin()" title="收起 / 展开">－</button>' +
            '<button class="floating-close-btn" onclick="closeFloatingPanel()" title="关闭（取消全部固定）">&times;</button>' +
        '</div>' +
        '<div class="floating-body" id="floatingBody" style="overflow-y:auto;padding:6px 8px;"></div>';
    document.body.appendChild(panel);
    return panel;
}

function renderFloating() {
    var panel = ensureFloatingPanel();
    var body = document.getElementById('floatingBody');
    if (!panel || !body) return;
    syncPipButton();

    var keys = getFloatingKeys();
    var alive = [];
    for (var i = 0; i < keys.length; i++) {
        var ti = findTodoByKey(keys[i]);
        if (ti < 0) continue;                                   // 待办已被删除
        if (!todos[ti].hasProgress || !todos[ti].subTasks) continue;
        alive.push(keys[i]);
    }
    if (alive.length !== keys.length) setFloatingKeys(alive);    // 顺手清掉失效的
    keys = alive;

    if (keys.length === 0) { panel.style.display = 'none'; pipRender(); return; }

    var html = '';
    for (var k = 0; k < keys.length; k++) {
        var idx = findTodoByKey(keys[k]);
        var t = todos[idx];
        var done = getCompletedCount(t.subTasks);
        var total = t.subTasks.length;
        var pct = total > 0 ? Math.round(done / total * 100) : 0;
        html += '<div class="floating-todo' + (t.completed ? ' done' : '') + '">';
        html += '<div class="floating-todo-head">';
        html += '<span class="floating-todo-text">' + t.text + '</span>';
        html += '<button class="floating-todo-unpin" onclick="unpinFloatingAt(' + k + ')" title="取消固定">&times;</button>';
        html += '</div>';
        html += '<div class="todo-progress-wrap">';
        html += '<span class="todo-progress-text">' + done + '/' + total + '</span>';
        html += '<div class="todo-progress-bar"><div class="todo-progress-fill" style="width:' + pct + '%"></div></div>';
        html += '<span class="todo-progress-pct">' + pct + '%</span>';
        html += '</div>';
        html += '<div class="floating-subgrid">';
        for (var j = 0; j < t.subTasks.length; j++) {
            html += '<label class="floating-sub">';
            html += '<input type="checkbox"' + (t.subTasks[j] ? ' checked' : '') + ' onchange="floatToggleSub(' + k + ',' + j + ')">';
            html += '<span>' + (j + 1) + '</span>';
            html += '</label>';
        }
        html += '</div></div>';
    }
    body.innerHTML = html;
    panel.style.display = '';
    panel.classList.toggle('floating-min', localStorage.getItem(FLOAT_MIN_KEY) === '1');
    applyFloatingPos(panel);
    pipRender();          // 独立置顶小窗跟着一起更新
}

function initFloatingDrag() {
    var panel = ensureFloatingPanel();
    var header = document.getElementById('floatingHeader');
    if (!panel || !header) return;
    var dragging = false, sx = 0, sy = 0, sl = 0, st = 0;

    function start(x, y) {
        var r = panel.getBoundingClientRect();
        dragging = true; sx = x; sy = y; sl = r.left; st = r.top;
        panel.style.right = 'auto';
        panel.style.left = r.left + 'px';
        panel.style.top = r.top + 'px';
    }
    function move(x, y) {
        if (!dragging) return;
        var nl = clampNum(sl + x - sx, 0, Math.max(0, window.innerWidth - 80));
        var nt = clampNum(st + y - sy, 0, Math.max(0, window.innerHeight - 50));
        panel.style.left = nl + 'px';
        panel.style.top = nt + 'px';
    }
    function end() {
        if (!dragging) return;
        dragging = false;
        var r = panel.getBoundingClientRect();
        localStorage.setItem(FLOAT_POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
    }

    header.addEventListener('mousedown', function (e) {
        if (e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        start(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
    document.addEventListener('mouseup', end);
    header.addEventListener('touchstart', function (e) {
        if (e.target.tagName === 'BUTTON') return;
        var t = e.touches[0]; start(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
        if (!dragging) return;
        var t = e.touches[0]; move(t.clientX, t.clientY);
    }, { passive: true });
    document.addEventListener('touchend', end);
    window.addEventListener('resize', function () { renderFloating(); });
}

/* ================= 独立置顶小窗（文档画中画，电脑版 Chrome / Edge 116+） =================
 * 网页内的浮层只能盖住“本网页”，永远盖不住记事本这类别的程序。
 * 系统的“画中画”窗口是真正的独立置顶窗口，所以待办可以浮在任何程序之上，且无需安装任何软件。 */
var pipWindow = null;

function pipSupported() { return 'documentPictureInPicture' in window; }

function syncPipButton() {
    var b = document.getElementById('floatingPipBtn');
    if (b) b.style.display = pipSupported() ? '' : 'none';
}

function toggleFloatingPip() {
    if (!pipSupported()) {
        alert('这个浏览器不支持「独立置顶小窗」。\n\n' +
            '· 电脑：请用 Chrome 或 Edge（116 以上版本）打开本网页；\n' +
            '· 手机：系统限制，网页无法浮在别的 App 上面。');
        return;
    }
    if (pipWindow && !pipWindow.closed) { try { pipWindow.close(); } catch (e) { } pipWindow = null; return; }

    documentPictureInPicture.requestWindow({ width: 300, height: 340 }).then(function (w) {
        pipWindow = w;
        var doc = w.document;
        doc.title = '悬浮待办';
        // 把主页面的样式搬过来，保证外观一致
        var src = document.querySelectorAll('link[rel="stylesheet"], style');
        for (var i = 0; i < src.length; i++) doc.head.appendChild(src[i].cloneNode(true));
        var extra = doc.createElement('style');
        extra.textContent =
            'html,body{margin:0;padding:0;height:100%;background:#f7f6f2;color:#2d3748;' +
            'font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;}' +
            '#pipWrap{display:flex;flex-direction:column;height:100%;}' +
            '#pipHead{display:flex;align-items:center;gap:6px;padding:6px 8px;flex-shrink:0;' +
            'background:linear-gradient(135deg,#7CB342,#9CCC65);color:#fff;font-weight:bold;font-size:12px;}' +
            '#pipBody{flex:1;overflow-y:auto;padding:8px 10px;}' +
            '#pipBody .todo-progress-wrap{margin-left:0;}' +
            '#pipBody .todo-progress-bar{flex:1;width:auto;}' +
            '.pip-empty{color:#a0aec0;text-align:center;padding:26px 6px;font-size:12px;line-height:1.8;}';
        doc.head.appendChild(extra);
        var wrap = doc.createElement('div');
        wrap.id = 'pipWrap';
        wrap.innerHTML = '<div id="pipHead"><span style="flex:1">📌 悬浮待办 · 始终置顶</span>' +
            '<span style="font-weight:normal;font-size:11px;opacity:.9;">点格子即打勾</span></div>' +
            '<div id="pipBody"></div>';
        doc.body.appendChild(wrap);
        pipRender();
        w.addEventListener('pagehide', function () { pipWindow = null; });
    }).catch(function (e) {
        alert('打开置顶小窗失败：' + (e && e.message ? e.message : e));
    });
}

function onPipSubToggle() {
    floatToggleSub(parseInt(this.getAttribute('data-k'), 10), parseInt(this.getAttribute('data-j'), 10));
}

function pipRender() {
    if (!pipWindow || pipWindow.closed) return;
    var doc = pipWindow.document;
    var body = doc.getElementById('pipBody');
    if (!body) return;

    var keys = getFloatingKeys();
    var html = '';
    for (var k = 0; k < keys.length; k++) {
        var ti = findTodoByKey(keys[k]);
        if (ti < 0) continue;
        var t = todos[ti];
        if (!t.hasProgress || !t.subTasks) continue;
        var done = getCompletedCount(t.subTasks);
        var total = t.subTasks.length;
        var pct = total > 0 ? Math.round(done / total * 100) : 0;
        html += '<div class="floating-todo' + (t.completed ? ' done' : '') + '">';
        html += '<div class="floating-todo-head"><span class="floating-todo-text">' + t.text + '</span></div>';
        html += '<div class="todo-progress-wrap">';
        html += '<span class="todo-progress-text">' + done + '/' + total + '</span>';
        html += '<div class="todo-progress-bar"><div class="todo-progress-fill" style="width:' + pct + '%"></div></div>';
        html += '<span class="todo-progress-pct">' + pct + '%</span>';
        html += '</div><div class="floating-subgrid">';
        for (var j = 0; j < total; j++) {
            html += '<label class="floating-sub"><input type="checkbox"' + (t.subTasks[j] ? ' checked' : '') +
                ' data-k="' + k + '" data-j="' + j + '"><span>' + (j + 1) + '</span></label>';
        }
        html += '</div></div>';
    }
    body.innerHTML = html || '<div class="pip-empty">还没有固定的待办<br>回到网页，点某个待办进度条右侧的 📌 即可</div>';

    var boxes = body.querySelectorAll('input[type="checkbox"]');
    for (var b = 0; b < boxes.length; b++) boxes[b].addEventListener('change', onPipSubToggle);
}

function onTodoRightClick(e, index) {
    e.preventDefault();
    var existingMenu = document.getElementById('contextMenu');
    if (existingMenu) existingMenu.remove();

    var menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.innerHTML =
        '<div class="context-menu-title">' + todos[index].text + '</div>' +
        '<div class="context-menu-item" onclick="openEditTodoModal(' + index + ')">编辑待办</div>' +
        '<div class="context-menu-item" onclick="addProgressBarToTodo(' + index + ')">添加进度条</div>' +
        '<div class="context-menu-item" onclick="addTodoToSchedule(' + index + ')">添加到日程</div>' +
        '<div class="context-menu-item context-menu-delete" onclick="deleteTodo(' + index + ')">删除待办</div>';
    document.body.appendChild(menu);

    function closeMenu() {
        var m = document.getElementById('contextMenu');
        if (m) m.remove();
        document.removeEventListener('click', closeMenu);
    }
    setTimeout(function() { document.addEventListener('click', closeMenu); }, 10);
}

function handleKeyPress(event) {
    if (event.key === 'Enter') addTodo();
}

function getTodayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function hasAutoTodo(text, dateStr) {
    return todos.some(function(t) { return t.text === text && t.autoDate === dateStr; });
}

function getDismissedAutoTodos() {
    try {
        return JSON.parse(localStorage.getItem('dismissedAutoTodos')) || [];
    } catch (e) {
        return [];
    }
}

function isAutoTodoDismissed(text, dateStr) {
    return getDismissedAutoTodos().some(function(d) { return d.text === text && d.date === dateStr; });
}

// 记录今天手动删除的自动待办，当天不再自动生成（第二天恢复）
function dismissAutoTodo(text) {
    var today = getTodayStr();
    var list = getDismissedAutoTodos().filter(function(d) { return d.date === today; });
    if (!list.some(function(d) { return d.text === text; })) {
        list.push({ text: text, date: today });
    }
    localStorage.setItem('dismissedAutoTodos', JSON.stringify(list));
}

function addAutoTodo(text) {
    var dateStr = getTodayStr();
    if (isAutoTodoDismissed(text, dateStr)) return;
    if (!hasAutoTodo(text, dateStr)) {
        todos.push({ text: text, createdAt: new Date().toISOString(), completed: false, autoDate: dateStr, actionDate: dateStr });
    }
}

function checkAutoTodos() {
    var now = new Date();
    var day = now.getDay();
    var hour = now.getHours();
    var minute = now.getMinutes();
    var timeNum = hour * 60 + minute;
    var dateStr = getTodayStr();

    var dailyMark = 'daily_' + dateStr;
    if (!hasAutoTodo('daily_mark', dateStr)) {
        addAutoTodo('刷力扣');
        addAutoTodo('打卡多邻国');
        addAutoTodo('🍎');
        todos.push({ text: 'daily_mark', createdAt: now.toISOString(), completed: false, autoDate: dateStr, hidden: true });
    }

    if (day === 4) {
        if (timeNum >= 720 && !hasAutoTodo('复习编译原理', dateStr)) {
            addAutoTodo('复习编译原理');
            addAutoTodo('抄编译原理');
        }
        if (timeNum >= 1020 && !hasAutoTodo('复习机器学习', dateStr)) {
            addAutoTodo('复习机器学习');
            addAutoTodo('抄机器学习');
        }
    }

    moveIncompleteTodos();
    localStorage.setItem('todos', JSON.stringify(todos));
    renderTodos();
}

// ===== 每周组会（每周四 21:30 自动维护）=====
// 规则：始终保留一条“开组会”待办 + 一条置顶的“开组会”DDL，指向下一个周四 21:30；
//       旧的到期后自动删除并生成下一个周四的（每周四 21:30 完成滚动）。
var GROUP_MEETING_TEXT = '开组会（370-8662-2005）';
var GROUP_MEETING_HOUR = '21:30';           // 组会时间：每周四 21:30
var GROUP_MEETING_WEEKDAY = 4;              // getDay()：0=周日，4=周四

// 下一个“周四 21:30”（严格晚于当前时刻）
function getNextGroupMeetingTime() {
    var now = new Date();
    var t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 30, 0, 0);
    var delta = (GROUP_MEETING_WEEKDAY - t.getDay() + 7) % 7;
    t.setDate(t.getDate() + delta);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 7);
    return t;
}

// 维护置顶的“开组会”DDL：自动删除到期/旧周期的，补上本周期的
function syncGroupMeetingDdl(targetKey) {
    var targetDate = normalizeDate(targetKey);      // 存储格式 YYYY/MM/DD
    var dismissed = localStorage.getItem('groupMeetingDdlDismissed') || '';
    var found = false;
    var changed = false;
    var kept = [];
    for (var i = 0; i < ddls.length; i++) {
        var d = ddls[i];
        if (d.autoType !== 'groupMeeting') { kept.push(d); continue; }
        if (d.date === targetDate && d.title === GROUP_MEETING_TEXT) {
            if (!d.pinned) { d.pinned = true; changed = true; }
            found = true;
            kept.push(d);
        } else {
            changed = true;                          // 已到期/换周：直接删除
        }
    }
    if (!found && dismissed !== targetDate) {
        kept.push({
            title: GROUP_MEETING_TEXT,
            date: targetDate,
            hour: GROUP_MEETING_HOUR,
            pinned: true,
            autoType: 'groupMeeting'
        });
        changed = true;
    }
    if (changed) {
        ddls = kept;
        localStorage.setItem('ddls', JSON.stringify(ddls));
    }
    return changed;
}

// 维护“开组会”待办：每周四 21:30 换新，旧的自动删除（周期用目标周四日期标记）
function syncGroupMeetingTodo(targetKey) {
    var lastCycle = localStorage.getItem('groupMeetingTodoCycle') || '';
    if (lastCycle === targetKey) return false;       // 本周期已生成过，不重复添加（手动完成/删除也不补回）
    var changed = false;
    var kept = [];
    for (var i = 0; i < todos.length; i++) {
        var t = todos[i];
        if (t.autoType === 'groupMeetingTodo') { changed = true; continue; }  // 上一周期的：到期自动删除
        kept.push(t);
    }
    var today = getTodayStr();
    kept.push({
        text: GROUP_MEETING_TEXT,
        createdAt: new Date().toISOString(),
        completed: false,
        autoDate: today,
        actionDate: today,
        autoType: 'groupMeetingTodo'
    });
    todos = kept;
    localStorage.setItem('groupMeetingTodoCycle', targetKey);
    localStorage.setItem('todos', JSON.stringify(todos));
    return true;
}

function syncGroupMeeting() {
    var targetKey = dateKey(getNextGroupMeetingTime());
    var ddlChanged = syncGroupMeetingDdl(targetKey);
    var todoChanged = syncGroupMeetingTodo(targetKey);
    if (ddlChanged) renderDDLs();
    if (todoChanged) renderTodos();
}

function cleanCompletedTodos() {
    var now = new Date();
    var today = getTodayStr();
    var lastDate = localStorage.getItem('lastRunDate');
    // 每天结束（23:59）时删除已完成的待办；跨天兜底用于程序在结束时刻未运行的情况
    var dayEnded = now.getHours() === 23 && now.getMinutes() === 59;
    if (dayEnded || (lastDate && lastDate < today)) {
        todos = todos.filter(function(t) { return !t.completed; });
        localStorage.setItem('todos', JSON.stringify(todos));
        renderTodos();
    }
    localStorage.setItem('lastRunDate', today);
}

function moveIncompleteTodos() {
    var today = getTodayStr();
    for (var i = 0; i < todos.length; i++) {
        var t = todos[i];
        if (t.hidden || t.completed) continue;
        if (t.autoDate) continue;
        if (t.actionDate && t.actionDate < today) {
            t.actionDate = today;
        }
    }
}

function renderResources() {
    var container = document.getElementById('resourceCards');
    if (resources.length === 0) {
        container.innerHTML = '<div class="empty-message">暂无资料</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < resources.length; i++) {
        var resource = resources[i];
        html += '<div class="resource-card" onclick="openResource(\'' + resource.url + '\')">' +
            '<div class="resource-actions">' +
            '<button onclick="event.stopPropagation();openEditResourceModal(' + i + ')" title="编辑">&#9998;</button>' +
            '<button class="delete-btn" onclick="event.stopPropagation();deleteResource(' + i + ')" title="删除">&#10005;</button>' +
            '</div>' +
            '<div class="resource-name">' + resource.name + '</div>' +
            '</div>';
    }
    container.innerHTML = html;
}

function addResource() {
    openAddResourceModal();
}

function deleteResource(index) {
    if (confirm('确定要删除这个资料吗？')) {
        resources.splice(index, 1);
        localStorage.setItem('resources', JSON.stringify(resources));
        renderResources();
    }
}

function openResource(url) {
    window.open(url, '_blank');
}

function openAddResourceModal() {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeCellModal(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>添加资料</h3>' +
        '<div class="modal-input-row"><label>资料名称</label>' +
        '<input type="text" id="modalResourceName" placeholder="输入资料名称..."></div>' +
        '<div class="modal-input-row"><label>网址</label>' +
        '<input type="text" id="modalResourceUrl" placeholder="输入网址..."></div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="closeCellModal()">取消</button>' +
        '<button class="confirm-btn" onclick="saveAddResource()">确认添加</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() { document.getElementById('modalResourceName').focus(); }, 100);
}

function saveAddResource() {
    var name = document.getElementById('modalResourceName').value.trim();
    var url = document.getElementById('modalResourceUrl').value.trim();
    
    if (name === '') { alert('请输入资料名称'); return; }
    if (url === '') { alert('请输入网址'); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    resources.push({
        id: Date.now(),
        name: name,
        url: url
    });
    localStorage.setItem('resources', JSON.stringify(resources));
    closeCellModal();
    renderResources();
}

function openEditResourceModal(index) {
    var resource = resources[index];
    
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeCellModal(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>编辑资料</h3>' +
        '<div class="modal-input-row"><label>资料名称</label>' +
        '<input type="text" id="modalResourceName" value="' + resource.name + '"></div>' +
        '<div class="modal-input-row"><label>网址</label>' +
        '<input type="text" id="modalResourceUrl" value="' + resource.url + '"></div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="closeCellModal()">取消</button>' +
        '<button class="confirm-btn" onclick="saveEditResource(' + index + ')">保存</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() { document.getElementById('modalResourceName').focus(); }, 100);
}

function saveEditResource(index) {
    var name = document.getElementById('modalResourceName').value.trim();
    var url = document.getElementById('modalResourceUrl').value.trim();
    
    if (name === '') { alert('请输入资料名称'); return; }
    if (url === '') { alert('请输入网址'); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    resources[index].name = name;
    resources[index].url = url;
    localStorage.setItem('resources', JSON.stringify(resources));
    closeCellModal();
    renderResources();
}

function parseDateStr(str) {
    var parts = str.split(' ');
    var dateParts = parts[0].replace(/-/g, '/').split('/');
    var d = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
    if (parts[1]) { var hm = parts[1].split(':'); d.setHours(parseInt(hm[0]), parseInt(hm[1]), 0, 0); }
    return d;
}

function normalizeDate(dateStr) {
    var parts = dateStr.split('-');
    return parts[0] + '/' + parts[1].padStart(2, '0') + '/' + parts[2].padStart(2, '0');
}

function renderDDLs() {
    var ddlList = document.getElementById('ddlItems');
    if (ddls.length === 0) { ddlList.innerHTML = '<div class="empty-message">暂无DDL</div>'; return; }
    // 置顶的DDL（如每周组会）永远排在最前，其余按到期时间排序
    ddls.sort(function(a, b) {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return parseDateStr(a.date + (a.hour ? ' ' + a.hour : ':00')) - parseDateStr(b.date + (b.hour ? ' ' + b.hour : ':00'));
    });
    var html = '';
    for (var i = 0; i < ddls.length; i++) {
        var ddl = ddls[i];
        var ddlDate = parseDateStr(ddl.date + (ddl.hour ? ' ' + ddl.hour : ':00'));
        var now = new Date();
        var diff = ddlDate - now;
        var countdownText = '', isOverdue = false;
        var nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var ddlDay = new Date(ddlDate.getFullYear(), ddlDate.getMonth(), ddlDate.getDate());
        if (diff <= 0) {
            isOverdue = true;
            if (ddl.hour) {
                var overdueSeconds = Math.floor(Math.abs(diff) / 1000);
                var od = Math.floor(overdueSeconds / 86400);
                var oh = Math.floor((overdueSeconds % 86400) / 3600);
                var om = Math.floor((overdueSeconds % 3600) / 60);
                countdownText = '过期' + od + '天' + oh + '小时' + om + '分钟';
            } else {
                var overdueDays = Math.floor((nowDate - ddlDay) / 86400000);
                if (overdueDays === 0) { countdownText = '今天'; isOverdue = false; }
                else if (overdueDays === 1) countdownText = '昨天过期';
                else if (overdueDays === 2) countdownText = '前天过期';
                else countdownText = '过期' + overdueDays + '天';
            }
        } else {
            if (ddl.hour) {
                var totalSeconds = Math.floor(diff / 1000);
                var days = Math.floor(totalSeconds / 86400);
                var hours = Math.floor((totalSeconds % 86400) / 3600);
                var minutes = Math.floor((totalSeconds % 3600) / 60);
                countdownText = days + '天' + hours + '小时' + minutes + '分钟';
            } else {
                var remainDays = Math.floor((ddlDay - nowDate) / 86400000);
                if (remainDays === 0) countdownText = '今天';
                else if (remainDays === 1) countdownText = '明天';
                else if (remainDays === 2) countdownText = '后天';
                else countdownText = remainDays + '天';
            }
        }
        html += '<li class="ddl-item' + (ddl.autoType === 'groupMeeting' ? ' ddl-group-meeting' : '') + '" oncontextmenu="onDdlRightClick(event,' + i + ')">' +
            '<label class="todo-check"><input type="checkbox" onchange="deleteDdl(' + i + ')"><span class="checkmark"></span></label>' +
            '<div class="ddl-info"><div class="ddl-title">' + ddl.title + '</div>' +
            '<div class="ddl-countdown ' + (isOverdue ? 'overdue' : '') + '">' + countdownText + '</div>' +
            '<div class="ddl-date-text">' + ddl.date + (ddl.hour ? ' ' + ddl.hour : '') + '</div></div></li>';
    }
    ddlList.innerHTML = html;
}

function addDdl() {
    var titleInput = document.getElementById('ddlTitle');
    var dateInput = document.getElementById('ddlDate');
    var hourSelect = document.getElementById('ddlHour');
    var title = titleInput.value.trim();
    var rawDate = dateInput.value;
    var date = normalizeDate(rawDate);
    var hour = hourSelect.value;
    if (title === '') { alert('请输入DDL标题'); return; }
    if (rawDate === '' || isNaN(parseDateStr(date))) { alert('请选择有效的DDL日期'); return; }
    ddls.push({ title: title, date: date, hour: hour });
    localStorage.setItem('ddls', JSON.stringify(ddls));
    titleInput.value = '';
    dateInput.value = todayDate();
    hourSelect.value = '';
    updateDatePlaceholder();
    renderDDLs();
}

function deleteDdl(index) {
    var ddl = ddls[index];
    // 手动删掉自动生成的“开组会”DDL：本次周期内不再补回（下周自动重新生成新的）
    if (ddl && ddl.autoType === 'groupMeeting') {
        localStorage.setItem('groupMeetingDdlDismissed', ddl.date);
    }
    ddls.splice(index, 1);
    localStorage.setItem('ddls', JSON.stringify(ddls));
    renderDDLs();
}

function openEditDdlModal(index) {
    var ddl = ddls[index];
    var rawDate = ddl.date.replace(/\//g, '-');
    var hourOptions = '<option value="">不限时</option>';
    var hourValues = ['00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'];
    // 自动生成的DDL可能是 21:30 这类非整点时间，补进下拉框避免编辑时丢失
    if (ddl.hour && hourValues.indexOf(ddl.hour) === -1) {
        hourValues.push(ddl.hour);
        hourValues.sort();
    }
    for (var i = 0; i < hourValues.length; i++) {
        var sel = ddl.hour === hourValues[i] ? ' selected' : '';
        hourOptions += '<option value="' + hourValues[i] + '"' + sel + '>' + hourValues[i] + '</option>';
    }
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="modal">' +
        '<h3>编辑DDL</h3>' +
        '<div class="modal-input-row"><label>DDL标题</label>' +
        '<input type="text" id="editDdlTitle" value="' + ddl.title.replace(/"/g, '&quot;') + '"></div>' +
        '<div class="modal-input-row"><label>日期</label>' +
        '<input type="date" id="editDdlDate" value="' + rawDate + '"></div>' +
        '<div class="modal-input-row"><label>时间</label>' +
        '<select id="editDdlHour">' + hourOptions + '</select></div>' +
        '<div class="modal-buttons">' +
        '<button class="cancel-btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button>' +
        '<button class="confirm-btn" onclick="saveEditDdl(' + index + ', this)">保存</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    setTimeout(function() { document.getElementById('editDdlTitle').focus(); }, 100);
}

function saveEditDdl(index, btn) {
    var overlay = btn.closest('.modal-overlay');
    var title = document.getElementById('editDdlTitle').value.trim();
    var rawDate = document.getElementById('editDdlDate').value;
    var hour = document.getElementById('editDdlHour').value;
    if (!title) { alert('请输入DDL标题'); return; }
    if (!rawDate) { alert('请选择日期'); return; }
    ddls[index].title = title;
    ddls[index].date = normalizeDate(rawDate);
    ddls[index].hour = hour;
    localStorage.setItem('ddls', JSON.stringify(ddls));
    overlay.remove();
    renderDDLs();
}

function addDdlToTodo(index) {
    var ddl = ddls[index];
    if (!ddl) return;
    todos.push({ text: ddl.title, createdAt: new Date().toISOString(), completed: false, actionDate: getTodayStr() });
    localStorage.setItem('todos', JSON.stringify(todos));
    renderTodos();
}

function addDdlToSchedule(index) {
    var ddl = ddls[index];
    if (!ddl) return;
    openAddScheduleModal(ddl.title);
}

function addTodoToSchedule(index) {
    var todo = todos[index];
    if (!todo) return;
    openAddScheduleModal(todo.text);
}

function onDdlRightClick(e, index) {
    e.preventDefault();
    var existingMenu = document.getElementById('contextMenu');
    if (existingMenu) existingMenu.remove();

    var menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.className = 'context-menu';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.innerHTML =
        '<div class="context-menu-title">' + ddls[index].title + '</div>' +
        '<div class="context-menu-item" onclick="openEditDdlModal(' + index + ')">编辑DDL</div>' +
        '<div class="context-menu-item" onclick="addDdlToTodo(' + index + ')">添加到待办</div>' +
        '<div class="context-menu-item" onclick="addDdlToSchedule(' + index + ')">添加到日程</div>' +
        '<div class="context-menu-item context-menu-delete" onclick="deleteDdl(' + index + ')">删除DDL</div>';
    document.body.appendChild(menu);

    function closeMenu() {
        var m = document.getElementById('contextMenu');
        if (m) m.remove();
        document.removeEventListener('click', closeMenu);
    }
    setTimeout(function() { document.addEventListener('click', closeMenu); }, 10);
}

function todayDate() { return new Date().toISOString().split('T')[0]; }

function updateDatePlaceholder() {
    var dateInput = document.getElementById('ddlDate');
    if (dateInput.value) dateInput.classList.add('has-value');
    else dateInput.classList.remove('has-value');
}

function initWeekSelect() {
    var weekSelect = document.getElementById('weekSelect');
    for (var w = 1; w <= 20; w++) {
        var option = document.createElement('option');
        option.value = w;
        option.textContent = '第' + w + '周';
        weekSelect.appendChild(option);
    }
    weekSelect.value = getCurrentWeek();
}

function getCurrentWeek() {
    var semesterStart = new Date(2026, 7, 24);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diff = today - semesterStart;
    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    var week = Math.floor(days / 7) + 1;
    if (week < 1) week = 1;
    if (week > 20) week = 20;
    return week;
}

document.addEventListener('DOMContentLoaded', function() {
    cleanCompletedTodos();
    renderTodos();
    renderDDLs();
    renderResources();
    initWeekSelect();
    renderScheduleGrid();
    initScheduleHover();
    checkAutoTodos();
    syncGroupMeeting();

    var ddlDateInput = document.getElementById('ddlDate');
    ddlDateInput.value = todayDate();
    updateDatePlaceholder();
    ddlDateInput.addEventListener('change', updateDatePlaceholder);
    ddlDateInput.addEventListener('input', updateDatePlaceholder);

    document.getElementById('todoInput').addEventListener('keypress', handleKeyPress);
    document.getElementById('addButton').addEventListener('click', addTodo);
    document.getElementById('addDdlButton').addEventListener('click', addDdl);
    document.getElementById('weekSelect').addEventListener('change', function() { renderScheduleGrid(); });
    document.getElementById('todoHasProgress').addEventListener('change', function() {
        document.getElementById('subtaskCountWrapper').style.display = this.checked ? 'flex' : 'none';
    });

    if (window.electronAPI) {
        window.electronAPI.onFloatingSubTaskChanged(function(todoIndex, subIdx, done) {
            if (todos[todoIndex] && todos[todoIndex].subTasks) {
                todos[todoIndex].subTasks[subIdx] = done;
                var completed = getCompletedCount(todos[todoIndex].subTasks);
                var total = todos[todoIndex].subTasks.length;
                todos[todoIndex].completed = (completed === total);
                localStorage.setItem('todos', JSON.stringify(todos));
                renderTodos();
            }
        });
    }

    // 每分钟：清理已完成待办、自动待办、以及每周组会的待办/DDL（周四21:30自动滚动到下周）
    setInterval(function() { cleanCompletedTodos(); checkAutoTodos(); syncGroupMeeting(); renderDDLs(); }, 60000);

    // ===== Tab Switching =====
    var tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            tabBtns.forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-tasks').style.display = tabId === 'tasks' ? 'flex' : 'none';
            document.getElementById('tab-notes').style.display = tabId === 'notes' ? 'flex' : 'none';
            if (tabId === 'tasks') fitSchedule();
        });
    });

    // 窗口尺寸变化（含最大化/换屏幕）时重新等比适配
    window.addEventListener('resize', function() { fitSchedule(); });
    // 兜底：每 250ms 检查一次容器宽度（计算极轻，确保任何情况下都能适配）
    setInterval(function() { fitSchedule(); }, 250);

    // ===== Notes / Memo =====
    var notes = JSON.parse(localStorage.getItem('notes')) || [];
    var editingNoteId = null;
    var currentAttachments = [];
    var noteAutoSaveTimer = null;

    function saveNotes() {
        localStorage.setItem('notes', JSON.stringify(notes));
    }

    function debounceAutoSave() {
        if (noteAutoSaveTimer) clearTimeout(noteAutoSaveTimer);
        noteAutoSaveTimer = setTimeout(function() {
            autoSaveNote();
        }, 800);
    }

    function autoSaveNote() {
        var title = document.getElementById('noteTitleInput').value.trim();
        var content = document.getElementById('noteContentInput').value.trim();

        if (!title && !content && currentAttachments.length === 0) return;

        // 防止"保存后又自动保存一次"，导致同一条便签存成两条
        var modal = document.getElementById('noteModal');
        var modalOpen = modal && modal.style.display !== 'none';
        if (!editingNoteId && !modalOpen) return;

        if (editingNoteId) {
            var note = notes.find(function(n) { return n.id === editingNoteId; });
            if (note) {
                note.title = title;
                note.content = content;
                note.attachments = currentAttachments.slice();
                note.updatedAt = Date.now();
            }
        } else {
            var newId = generateNoteId();
            notes.unshift({
                id: newId,
                title: title,
                content: content,
                attachments: currentAttachments.slice(),
                createdAt: Date.now()
            });
            editingNoteId = newId;
        }
        
        saveNotes();
        renderNotes();
        
        var indicator = document.getElementById('autoSaveIndicator');
        if (indicator) {
            indicator.textContent = '已自动保存';
            setTimeout(function() { indicator.textContent = ''; }, 2000);
        }
    }

    function generateNoteId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    function formatDate(timestamp) {
        var d = new Date(timestamp);
        var m = d.getMonth() + 1;
        var day = d.getDate();
        var h = d.getHours();
        var min = d.getMinutes();
        return m + '月' + day + '日 ' + (h < 10 ? '0' + h : h) + ':' + (min < 10 ? '0' + min : min);
    }

    function getFileIcon(filename) {
        var ext = filename.split('.').pop().toLowerCase();
        var icons = { jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', bmp:'🖼', pdf:'📄', doc:'📝', docx:'📝', txt:'📃', md:'📋', ppt:'📊', pptx:'📊' };
        return icons[ext] || '📎';
    }

    function renderAttachmentsList(attachments) {
        var list = document.getElementById('noteAttachmentsList');
        if (!list) return;  // 网页版已移除附件功能
        if (!attachments || attachments.length === 0) {
            list.innerHTML = '<div class="note-attachments-empty">暂无附件</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < attachments.length; i++) {
            var att = attachments[i];
            html += '<div class="note-attachment-item" onclick="openNoteAttachment(\'' + att.storedName + '\')" title="点击打开">';
            html += '<span class="note-attachment-icon">' + getFileIcon(att.name) + '</span>';
            html += '<span class="note-attachment-name">' + escapeHtml(att.name) + '</span>';
            html += '<button class="note-attachment-remove-btn" onclick="event.stopPropagation();removeNoteAttachment(' + i + ')" title="删除">&times;</button>';
            html += '</div>';
        }
        list.innerHTML = html;
    }

    window.openNoteAttachment = async function(storedName) {
        if (!window.electronAPI) return;
        await window.electronAPI.openAttachment(storedName);
    };

    window.addNoteAttachment = async function() {
        if (!window.electronAPI) {
            alert('附件功能需要在 Electron 中运行');
            return;
        }
        var uploaded = await window.electronAPI.uploadAttachment();
        if (uploaded && uploaded.length > 0) {
            currentAttachments = currentAttachments.concat(uploaded);
            renderAttachmentsList(currentAttachments);
        }
    };

    window.removeNoteAttachment = async function(index) {
        var att = currentAttachments[index];
        if (window.electronAPI && att.storedName) {
            await window.electronAPI.deleteAttachment(att.storedName);
        }
        currentAttachments.splice(index, 1);
        renderAttachmentsList(currentAttachments);
    };

    function renderNotes() {
        var grid = document.getElementById('notesGrid');
        if (notes.length === 0) {
            grid.innerHTML = '<div class="note-empty">暂无便签，点击右上角新建</div>';
            return;
        }
        var html = '';
        for (var i = 0; i < notes.length; i++) {
            var note = notes[i];
            var title = note.title || '无标题';
            var content = note.content || '';
            var time = formatDate(note.createdAt);
            var attCount = (note.attachments && note.attachments.length) || 0;
            html += '<div class="note-card" data-id="' + note.id + '" onclick="editNote(\'' + note.id + '\')">';
            html += '<div class="note-card-header">';
            html += '<div class="note-card-title">' + escapeHtml(title) + '</div>';
            html += '<div class="note-card-actions">';
            html += '<button onclick="event.stopPropagation();editNote(\'' + note.id + '\')" title="编辑">&#9998;</button>';
            html += '<button class="delete-btn" onclick="event.stopPropagation();deleteNote(\'' + note.id + '\')" title="删除">&#10005;</button>';
            html += '</div>';
            html += '</div>';
            html += '<div class="note-card-content">' + escapeHtml(content) + '</div>';
            if (attCount > 0) {
                html += '<div class="note-card-attachments">';
                for (var j = 0; j < note.attachments.length; j++) {
                    html += '<span class="note-card-att-item" onclick="event.stopPropagation();openNoteAttachment(\'' + note.attachments[j].storedName + '\')" title="点击打开">' + getFileIcon(note.attachments[j].name) + ' ' + escapeHtml(note.attachments[j].name) + '</span>';
                }
                html += '</div>';
            }
            html += '<div class="note-card-time">' + time + '</div>';
            html += '</div>';
        }
        grid.innerHTML = html;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    window.openNoteModal = function(id) {
        editingNoteId = id || null;
        var modal = document.getElementById('noteModal');
        var titleEl = document.getElementById('noteModalTitle');
        var titleInput = document.getElementById('noteTitleInput');
        var contentInput = document.getElementById('noteContentInput');
        if (editingNoteId) {
            var note = notes.find(function(n) { return n.id === editingNoteId; });
            if (note) {
                titleEl.textContent = '编辑便签';
                titleInput.value = note.title;
                contentInput.value = note.content;
                currentAttachments = (note.attachments || []).map(function(a) { return { name: a.name, storedName: a.storedName }; });
            }
        } else {
            titleEl.textContent = '新建便签';
            titleInput.value = '';
            contentInput.value = '';
            currentAttachments = [];
        }
        renderAttachmentsList(currentAttachments);
        
        titleInput.removeEventListener('input', debounceAutoSave);
        contentInput.removeEventListener('input', debounceAutoSave);
        titleInput.addEventListener('input', debounceAutoSave);
        contentInput.addEventListener('input', debounceAutoSave);
        
        modal.style.display = 'flex';
        titleInput.focus();
    };

    window.closeNoteModal = function(event) {
        if (event && event.target !== document.getElementById('noteModal')) return;
        if (noteAutoSaveTimer) clearTimeout(noteAutoSaveTimer);
        autoSaveNote();
        document.getElementById('noteModal').style.display = 'none';
        editingNoteId = null;
        currentAttachments = [];
    };

    window.saveNote = function() {
        // 关键：先取消还没触发的"自动保存"，否则它会用同样的内容再新建一条（重复便签的元凶）
        if (noteAutoSaveTimer) { clearTimeout(noteAutoSaveTimer); noteAutoSaveTimer = null; }
        var title = document.getElementById('noteTitleInput').value.trim();
        var content = document.getElementById('noteContentInput').value.trim();
        if (!title && !content && currentAttachments.length === 0) { 
            document.getElementById('noteModal').style.display = 'none';
            editingNoteId = null;
            currentAttachments = [];
            return; 
        }
        if (editingNoteId) {
            var note = notes.find(function(n) { return n.id === editingNoteId; });
            if (note) {
                note.title = title;
                note.content = content;
                note.attachments = currentAttachments.slice();
                note.updatedAt = Date.now();
            }
        } else {
            var newId = generateNoteId();
            notes.unshift({
                id: newId,
                title: title,
                content: content,
                attachments: currentAttachments.slice(),
                createdAt: Date.now()
            });
            editingNoteId = newId;
        }
        saveNotes();
        renderNotes();
        document.getElementById('noteModal').style.display = 'none';
        editingNoteId = null;
        currentAttachments = [];
    };

    window.editNote = function(id) {
        openNoteModal(id);
    };

    window.deleteNote = async function(id) {
        var note = notes.find(function(n) { return n.id === id; });
        if (note && note.attachments && note.attachments.length > 0 && window.electronAPI) {
            for (var i = 0; i < note.attachments.length; i++) {
                await window.electronAPI.deleteAttachment(note.attachments[i].storedName);
            }
        }
        notes = notes.filter(function(n) { return n.id !== id; });
        saveNotes();
        renderNotes();
    };

    renderNotes();
    renderFloating();
    initFloatingDrag();
    renderLyrics();
});

/* ================= 每日韩语歌词 ================= */
var LYRICS_OFFSET_KEY = '__lyrics_offset';   // 设备本地：手动翻看用的偏移，不参与云同步
var lyricsShowVocab = false;

function lyricsEsc(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function lyricsDayIndex(total) {
    var L = window.KOREAN_LYRICS || {};
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var base = today;
    if (L.startDate) {
        var p = String(L.startDate).split('-');
        if (p.length === 3) base = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    }
    var days = Math.floor((today - base) / 86400000);
    if (!isFinite(days) || days < 0) days = 0;
    var off = parseInt(localStorage.getItem(LYRICS_OFFSET_KEY) || '0', 10);
    if (!isFinite(off)) off = 0;
    return ((days + off) % total + total) % total;
}

function lyricsMarkVocab(line) {
    var text = lyricsEsc(line.ko);
    if (!lyricsShowVocab || !line.vocab || !line.vocab.length) return text;
    for (var i = 0; i < line.vocab.length; i++) {
        var w = line.vocab[i] && line.vocab[i].w;
        if (!w) continue;
        var ew = lyricsEsc(w);
        if (text.indexOf(ew) >= 0) {
            text = text.split(ew).join('<span class="lyrics-vocab-mark">' + ew + '</span>');
        }
    }
    return text;
}

function renderLyrics() {
    var card = document.getElementById('lyricsCard');
    if (!card) return;
    var L = window.KOREAN_LYRICS;
    var song = document.getElementById('lyricsSong');
    var lines = (L && Array.isArray(L.lines)) ? L.lines.filter(function (x) { return x && x.ko; }) : [];

    var showTitle = L && L.title && L.title.indexOf('待替换') < 0 && L.title.indexOf('示例') < 0;
    if (song) song.textContent = showTitle ? '· ' + L.title : '';

    if (lines.length === 0) {
        card.innerHTML = '<div class="lyrics-empty">还没有歌词。把歌词填到 <code>lyrics.js</code> 里即可（每天自动换一句）。</div>';
        return;
    }

    var idx = lyricsDayIndex(lines.length);
    var line = lines[idx];
    var off = parseInt(localStorage.getItem(LYRICS_OFFSET_KEY) || '0', 10) || 0;

    var html = '';
    html += '<div class="lyrics-meta">第 ' + (idx + 1) + ' / ' + lines.length + ' 句' +
        (off !== 0 ? ' <span class="lyrics-offtag">（翻看中）</span>' : '') + '</div>';
    html += '<div class="lyrics-ko">' + lyricsMarkVocab(line) + '</div>';
    html += '<div class="lyrics-zh">' + lyricsEsc(line.zh) + '</div>';

    if (line.vocab && line.vocab.length) {
        html += '<button class="lyrics-vocab-btn" onclick="toggleLyricsVocab()">' +
            (lyricsShowVocab ? '隐藏词汇' : '显示词汇') + '</button>';
        if (lyricsShowVocab) {
            html += '<div class="lyrics-vocab-list">';
            for (var i = 0; i < line.vocab.length; i++) {
                var v = line.vocab[i] || {};
                html += '<div class="lyrics-vocab-item"><span class="lyrics-vocab-w">' + lyricsEsc(v.w) +
                    '</span><span class="lyrics-vocab-m">' + lyricsEsc(v.m) + '</span></div>';
            }
            html += '</div>';
        }
    }

    html += '<div class="lyrics-nav">';
    html += '<button onclick="shiftLyrics(-1)">← 上一句</button>';
    if (off !== 0) html += '<button class="lyrics-today-btn" onclick="shiftLyrics(0)">回到今天</button>';
    html += '<button onclick="shiftLyrics(1)">下一句 →</button>';
    html += '</div>';

    card.innerHTML = html;
}

window.toggleLyricsVocab = function () {
    lyricsShowVocab = !lyricsShowVocab;
    renderLyrics();
};

window.shiftLyrics = function (delta) {
    if (delta === 0) {
        localStorage.removeItem(LYRICS_OFFSET_KEY);
    } else {
        var off = parseInt(localStorage.getItem(LYRICS_OFFSET_KEY) || '0', 10) || 0;
        localStorage.setItem(LYRICS_OFFSET_KEY, String(off + delta));
    }
    renderLyrics();
};