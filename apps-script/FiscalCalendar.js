function getFiscalInfo(date) {
  var key = dateKey_(date);
  var rows = getSheetData(SHEET_NAMES.FISCAL_CALENDAR);

  for (var i = 0; i < rows.length; i++) {
    if (dateKey_(rows[i].Date) === key) {
      return normalizeFiscalInfo_(rows[i]);
    }
  }

  return buildFiscalInfoForDate_(dateOnly_(date));
}

function getCurrentFiscalWeek(date) {
  return getFiscalInfo(date || new Date()).fiscalWeek;
}

function getCurrentFiscalMonth(date) {
  return getFiscalInfo(date || new Date()).fiscalMonth;
}

function getReportWindow(reportType, referenceDate) {
  var type = String(reportType || '').trim().toLowerCase();
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();

  if (type === 'daily') {
    return getOperationalDayWindow(reference);
  }

  if (type === 'weekly') {
    var weeklyLookupDate = addDays_(dateOnly_(reference), -1);
    var weeklyInfo = getFiscalInfo(weeklyLookupDate);
    var weeklyStart = dateTime_(weeklyInfo.weekStart, 8, 0);
    var weeklyEnd = dateTime_(addDays_(weeklyInfo.weekEnd, 1), 8, 0);
    return buildWindow_('weekly', weeklyStart, weeklyEnd, weeklyInfo);
  }

  if (type === 'monthly') {
    var monthlyLookupDate = addDays_(dateOnly_(reference), -1);
    var monthlyInfo = getFiscalInfo(monthlyLookupDate);
    var monthlyStart = dateTime_(monthlyInfo.monthStart, 8, 0);
    var monthlyEnd = dateTime_(addDays_(monthlyInfo.monthEnd, 1), 8, 0);
    return buildWindow_('monthly', monthlyStart, monthlyEnd, monthlyInfo);
  }

  throw new Error('Unsupported report type: ' + reportType);
}

function getOperationalDayWindow(referenceDate) {
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  var end = dateTime_(reference, 8, 0);

  if (reference.getTime() < end.getTime()) {
    end = addDays_(end, -1);
  }

  var start = addDays_(end, -1);
  var fiscalInfo = getFiscalInfo(start);
  return buildWindow_('daily', start, end, fiscalInfo);
}

function getShiftWindow(shift, referenceDate) {
  var normalizedShift = normalizeShift_(shift);
  var reference = referenceDate ? parseDate_(referenceDate) : new Date();
  var end;
  var start;

  if (normalizedShift === 'Night') {
    end = dateTime_(reference, 8, 0);
    if (reference.getTime() < end.getTime()) {
      end = addDays_(end, -1);
    }
    start = dateTime_(end, 0, 0);
  } else if (normalizedShift === 'Day') {
    end = dateTime_(reference, 16, 0);
    if (reference.getTime() < end.getTime()) {
      end = addDays_(end, -1);
    }
    start = dateTime_(end, 8, 0);
  } else if (normalizedShift === 'Mid') {
    end = dateTime_(reference, 0, 0);
    start = dateTime_(addDays_(end, -1), 16, 0);
  } else {
    throw new Error('Unsupported shift: ' + shift);
  }

  var fiscalInfo = getFiscalInfo(getOperationalDateForDateTime_(start));
  return {
    shift: normalizedShift,
    startDate: start,
    endDate: end,
    fiscalWeek: fiscalInfo.fiscalWeek,
    fiscalMonth: fiscalInfo.fiscalMonth,
    periodLabel: normalizedShift + ' shift | ' + formatDateTime_(start) + ' to ' + formatDateTime_(end)
  };
}

function buildFiscalCalendarRows_(startDate, endDate) {
  var rows = [];
  var cursor = dateOnly_(startDate);
  var last = dateOnly_(endDate);

  while (cursor.getTime() <= last.getTime()) {
    var info = buildFiscalInfoForDate_(cursor);
    rows.push([
      dateKey_(cursor),
      info.fiscalYear,
      info.fiscalMonth,
      info.fiscalWeek,
      dateKey_(info.weekStart),
      dateKey_(info.weekEnd),
      dateKey_(info.monthStart),
      dateKey_(info.monthEnd)
    ]);
    cursor = addDays_(cursor, 1);
  }

  return rows;
}

function buildWindow_(reportType, startDate, endDate, fiscalInfo) {
  return {
    reportType: reportType,
    startDate: startDate,
    endDate: endDate,
    fiscalWeek: fiscalInfo.fiscalWeek,
    fiscalMonth: fiscalInfo.fiscalMonth,
    fiscalYear: fiscalInfo.fiscalYear,
    periodLabel: formatDateTime_(startDate) + ' to ' + formatDateTime_(endDate)
  };
}

function normalizeFiscalInfo_(row) {
  return {
    date: dateOnly_(row.Date),
    fiscalYear: String(row['Fiscal Year'] || ''),
    fiscalMonth: String(row['Fiscal Month'] || ''),
    fiscalWeek: String(row['Fiscal Week'] || ''),
    weekStart: dateOnly_(row['Week Start']),
    weekEnd: dateOnly_(row['Week End']),
    monthStart: dateOnly_(row['Month Start']),
    monthEnd: dateOnly_(row['Month End'])
  };
}

function buildFiscalInfoForDate_(date) {
  var target = dateOnly_(date);
  var fiscalYear = getFiscalYearForDate_(target);
  var fiscalYearStart = getFiscalYearStart_(fiscalYear);
  var weekNumber = Math.floor((target.getTime() - fiscalYearStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  var fiscalMonthInfo = getFiscalMonthInfo_(fiscalYear, weekNumber);
  var weekStart = addDays_(fiscalYearStart, (weekNumber - 1) * 7);
  var weekEnd = addDays_(weekStart, 6);
  var monthStart = addDays_(fiscalYearStart, (fiscalMonthInfo.startWeek - 1) * 7);
  var monthEnd = addDays_(fiscalYearStart, fiscalMonthInfo.endWeek * 7 - 1);

  return {
    date: target,
    fiscalYear: 'FY' + fiscalYear,
    fiscalMonth: 'FY' + fiscalYear + '-M' + pad2_(fiscalMonthInfo.monthNumber) + ' ' + fiscalMonthInfo.monthLabel,
    fiscalWeek: 'FY' + fiscalYear + '-W' + pad2_(weekNumber),
    weekStart: weekStart,
    weekEnd: weekEnd,
    monthStart: dateOnly_(monthStart),
    monthEnd: dateOnly_(monthEnd)
  };
}

function getFiscalYearForDate_(dateValue) {
  var date = dateOnly_(dateValue);
  var candidateYear = date.getFullYear();
  var candidateStart = getFiscalYearStart_(candidateYear);

  if (date.getTime() < candidateStart.getTime()) {
    return candidateYear - 1;
  }

  var nextStart = getFiscalYearStart_(candidateYear + 1);
  if (date.getTime() >= nextStart.getTime()) {
    return candidateYear + 1;
  }

  return candidateYear;
}

function getFiscalYearStart_(fiscalYear) {
  var janFirst = new Date(fiscalYear, 0, 1);
  return getSunday_(janFirst);
}

function getFiscalMonthInfo_(fiscalYear, weekNumber) {
  var weekPattern = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5];
  var labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var startWeek = 1;

  for (var i = 0; i < weekPattern.length; i++) {
    var endWeek = startWeek + weekPattern[i] - 1;
    if (weekNumber >= startWeek && weekNumber <= endWeek) {
      return {
        monthNumber: i + 1,
        monthLabel: labels[i],
        startWeek: startWeek,
        endWeek: endWeek
      };
    }
    startWeek = endWeek + 1;
  }

  return {
    monthNumber: 12,
    monthLabel: 'Dec',
    startWeek: 48,
    endWeek: 52
  };
}

function getOperationalDateForDateTime_(value) {
  var date = parseDate_(value);
  var operationalDate = dateOnly_(date);
  if (date.getHours() < 8) {
    operationalDate = addDays_(operationalDate, -1);
  }
  return operationalDate;
}

function getShiftForDateTime_(value) {
  var date = parseDate_(value);
  var hour = date.getHours();

  if (hour >= 8 && hour < 16) {
    return 'Day';
  }
  if (hour >= 16) {
    return 'Mid';
  }
  return 'Night';
}

function dateOnly_(value) {
  var date = parseDate_(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateTime_(dateValue, hour, minute) {
  var date = dateOnly_(dateValue);
  date.setHours(hour, minute || 0, 0, 0);
  return date;
}

function parseDate_(value) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  var text = String(value || '').trim();
  if (!text) {
    return new Date();
  }

  var dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]));
  }

  var southAfricanDateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (southAfricanDateMatch) {
    return new Date(Number(southAfricanDateMatch[3]), Number(southAfricanDateMatch[2]) - 1, Number(southAfricanDateMatch[1]));
  }

  var parsed = new Date(text);
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date value: ' + value);
  }
  return parsed;
}

function addDays_(dateValue, days) {
  var date = parseDate_(dateValue);
  date.setDate(date.getDate() + days);
  return date;
}

function addMinutes_(dateValue, minutes) {
  var date = parseDate_(dateValue);
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function dateKey_(value) {
  return Utilities.formatDate(dateOnly_(value), getReportTimezone_(), 'yyyy-MM-dd');
}

function formatDateTime_(value) {
  return Utilities.formatDate(parseDate_(value), getReportTimezone_(), 'yyyy-MM-dd HH:mm');
}

function getMonday_(dateValue) {
  var date = dateOnly_(dateValue);
  var day = date.getDay();
  var offset = day === 0 ? -6 : 1 - day;
  return addDays_(date, offset);
}

function getSunday_(dateValue) {
  var date = dateOnly_(dateValue);
  return addDays_(date, -date.getDay());
}

function getIsoWeek_(dateValue) {
  var date = dateOnly_(dateValue);
  var thursday = addDays_(date, 3 - ((date.getDay() + 6) % 7));
  var firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday = addDays_(firstThursday, 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function pad2_(number) {
  return String(number).padStart(2, '0');
}
