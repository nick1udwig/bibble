#include <pebble.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "bible_meta.h"
#include "message_keys.auto.h"

#define BIBBLE_STATUS_LENGTH 160
#define BIBBLE_READER_TEXT_LENGTH 512
#define BIBBLE_PAYLOAD_LENGTH 600
#define BIBBLE_DICTATION_LENGTH 128
#define BIBBLE_REF_LENGTH 80
#define BIBBLE_GRID_COLUMNS 3
#define BIBBLE_GRID_CELL_HEIGHT 38
#define BIBBLE_ROUND_GRID_SIDE_INSET 30
#define BIBBLE_ROUND_GRID_BOTTOM_GAP 4
#define BIBBLE_TOUCH_TAP_MAX_PX 15
#define BIBBLE_TOUCH_SWIPE_MIN_PX 40
#define BIBBLE_HEADER_HEIGHT_14 18
#define BIBBLE_HEADER_HEIGHT_18 22
#define BIBBLE_HEADER_HEIGHT_24 28
#define BIBBLE_HEADER_TIME_WIDTH_14 42
#define BIBBLE_HEADER_TIME_WIDTH_18 52
#define BIBBLE_HEADER_TIME_WIDTH_24 68
#define BIBBLE_READER_TEXT_PADDING 4
#define BIBBLE_READER_TEXT_MEASURE_HEIGHT 24000
#define BIBBLE_ROUND_READER_SIDE_INSET 30
#define BIBBLE_ROUND_READER_TOP_INSET 30
#define BIBBLE_ROUND_READER_BOTTOM_GAP 10
#define BIBBLE_ROUND_HEADER_HEIGHT_14 24
#define BIBBLE_ROUND_HEADER_HEIGHT_18 28
#define BIBBLE_ROUND_HEADER_HEIGHT_24 34
#define BIBBLE_ROUND_HEADER_SIDE_INSET_14 76
#define BIBBLE_ROUND_HEADER_SIDE_INSET_18 70
#define BIBBLE_ROUND_HEADER_SIDE_INSET_24 60
#define BIBBLE_PAGE_CACHE_SIZE 8
#define BIBBLE_PREFETCH_STEP_COUNT 6
#define BIBBLE_OUTBOX_QUEUE_SIZE 8
#define BIBBLE_OUTBOX_TYPE_LENGTH 24
#define BIBBLE_OUTBOX_RETRY_MS 50
#define BIBBLE_PAGE_RESPONSE_TIMEOUT_MS 30000
#define BIBBLE_READY_DELAY_MS 300
#define BIBBLE_PAGE_REQUEST_DELAY_MS 120
#define BIBBLE_SELECT_HOLD_MS 700
#define BIBBLE_PERSIST_LEGACY_LARGE_TEXT 1
#define BIBBLE_PERSIST_FONT_SIZE 2
#define BIBBLE_PERSIST_FONT_BOLD 3

#define BIBBLE_MSG_READY "ready"
#define BIBBLE_MSG_PAGE_REQUEST "page_request"
#define BIBBLE_MSG_PREFETCH_REQUEST "prefetch_request"
#define BIBBLE_MSG_DICTATION_LOOKUP "dictation_lookup"
#define BIBBLE_MSG_STATUS "status"
#define BIBBLE_MSG_PAGE "page"
#define BIBBLE_MSG_PREFETCH_PAGE "prefetch_page"
#define BIBBLE_MSG_SETTINGS "settings"
#define BIBBLE_MSG_NAVIGATE "navigate"
#define BIBBLE_MSG_ERROR "error"

static Window *s_book_window;
static Window *s_chapter_window;
static Window *s_verse_window;
static Window *s_reader_window;
static ScrollLayer *s_book_scroll_layer;
static ScrollLayer *s_chapter_scroll_layer;
static ScrollLayer *s_verse_scroll_layer;
static ScrollLayer *s_reader_scroll_layer;
static Layer *s_book_grid_layer;
static Layer *s_chapter_grid_layer;
static Layer *s_verse_grid_layer;
static Layer *s_book_header_layer;
static Layer *s_chapter_header_layer;
static Layer *s_verse_header_layer;
static Layer *s_reader_header_layer;
static TextLayer *s_book_status_layer;
static TextLayer *s_chapter_status_layer;
static TextLayer *s_verse_status_layer;
static TextLayer *s_book_time_layer;
static TextLayer *s_chapter_time_layer;
static TextLayer *s_verse_time_layer;
static TextLayer *s_reader_body_layer;
static TextLayer *s_reader_reference_layer;
static TextLayer *s_reader_time_layer;
static AppTimer *s_ready_timer;
static AppTimer *s_page_request_timer;
static AppTimer *s_select_hold_timer;
static AppTimer *s_outbox_retry_timer;
static AppTimer *s_page_response_timer;
#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation_session;
#endif

static char s_status[BIBBLE_STATUS_LENGTH] = "Select a book";
static char s_chapter_status[BIBBLE_STATUS_LENGTH] = "";
static char s_verse_status[BIBBLE_STATUS_LENGTH] = "";
static char s_reader_text[BIBBLE_READER_TEXT_LENGTH] = "";
static char s_current_reference[BIBBLE_REF_LENGTH] = "";
static char s_reader_reference[BIBBLE_REF_LENGTH] = "";
static char s_header_time[8] = "";
static uint8_t s_selected_book;
static uint8_t s_selected_chapter = 1;
static uint16_t s_selected_chapter_index;
static uint16_t s_selected_verse_index;
static uint8_t s_current_book;
static uint8_t s_current_chapter = 1;
static uint8_t s_current_verse = 1;
static uint16_t s_current_page = 1;
static uint16_t s_page_count = 1;
static uint8_t s_pending_page_book;
static uint8_t s_pending_page_chapter;
static uint8_t s_pending_page_verse;
static uint16_t s_pending_page;
static uint16_t s_page_request_generation;
static bool s_reader_loading;
static uint8_t s_font_size = 18;
static bool s_bold_text = true;
static bool s_select_hold_fired;
static bool s_touch_subscribed;
static bool s_touch_down;
static bool s_touch_dragged;
static int s_touch_down_x;
static int s_touch_down_y;
static int s_touch_last_y;

typedef struct {
  bool valid;
  uint8_t book;
  uint8_t chapter;
  uint8_t verse;
  uint16_t page;
  uint16_t page_count;
  uint32_t last_used;
  char text[BIBBLE_READER_TEXT_LENGTH];
} BibbleCachedPage;

typedef struct {
  uint8_t book;
  uint8_t chapter;
  uint16_t page;
  uint16_t page_count;
} BibblePageCursor;

typedef struct {
  bool report_error;
  bool prefetch;
  char type[BIBBLE_OUTBOX_TYPE_LENGTH];
  char payload[BIBBLE_DICTATION_LENGTH];
} BibbleOutgoingMessage;

static BibbleCachedPage s_page_cache[BIBBLE_PAGE_CACHE_SIZE];
static uint32_t s_page_cache_clock;
static uint16_t s_prefetch_generation;
static uint8_t s_prefetch_step;
static int8_t s_prefetch_direction;
static bool s_prefetch_in_flight;
static BibblePageCursor s_prefetch_forward_cursor;
static BibblePageCursor s_prefetch_backward_cursor;
static BibbleOutgoingMessage s_outbox_queue[BIBBLE_OUTBOX_QUEUE_SIZE];
static uint8_t s_outbox_count;
static bool s_outbox_busy;
// Interleave the nearest pages in both directions, then spend the larger window on look-ahead.
static const int8_t BIBBLE_PREFETCH_DIRECTIONS[BIBBLE_PREFETCH_STEP_COUNT] = {1, -1, 1, -1, 1, 1};

typedef enum {
  BibbleGridKindNone = 0,
  BibbleGridKindBook,
  BibbleGridKindChapter,
  BibbleGridKindVerse,
} BibbleGridKind;

static void prv_set_status(const char *status);
static void prv_update_status_layers(void);
static void prv_update_active_status_layer(void);
static void prv_update_reader_layers(bool reset_scroll);
static void prv_start_prefetch(void);
static bool prv_send_message(const char *type, const char *payload);
static void prv_flush_outbox_queue(void);
static void prv_request_page(uint8_t book, uint8_t chapter, uint8_t verse, uint16_t page);
static void prv_schedule_page_request(uint8_t book, uint8_t chapter, uint8_t verse, uint16_t page);
static void prv_show_chapter_window(uint8_t book, uint8_t chapter);
static void prv_show_verse_window(uint8_t book, uint8_t chapter, uint8_t verse);
static void prv_show_reader_window(uint8_t book, uint8_t chapter, uint8_t verse, bool request_page);
static void prv_start_dictation(void);
static BibbleGridKind prv_active_grid(void);
static void prv_touch_handler(const TouchEvent *event, void *context);
static void prv_grid_click_config_provider(void *context);
static void prv_reader_click_config_provider(void *context);
static void prv_minute_tick_handler(struct tm *tick_time, TimeUnits units_changed);
static void prv_select_raw_down_handler(ClickRecognizerRef recognizer, void *context);
static void prv_select_raw_up_handler(ClickRecognizerRef recognizer, void *context);

static int16_t prv_grid_cell_height(void) {
  return BIBBLE_GRID_CELL_HEIGHT;
}

static int16_t prv_header_height(void) {
#if defined(PBL_ROUND)
  if (s_font_size == 24) {
    return BIBBLE_ROUND_HEADER_HEIGHT_24;
  }
  if (s_font_size == 18) {
    return BIBBLE_ROUND_HEADER_HEIGHT_18;
  }
  return BIBBLE_ROUND_HEADER_HEIGHT_14;
#else
  if (s_font_size == 24) {
    return BIBBLE_HEADER_HEIGHT_24;
  }
  if (s_font_size == 18) {
    return BIBBLE_HEADER_HEIGHT_18;
  }
  return BIBBLE_HEADER_HEIGHT_14;
#endif
}

static int16_t prv_header_text_height(void) {
  if (s_font_size == 24) {
    return BIBBLE_HEADER_HEIGHT_24;
  }
  if (s_font_size == 18) {
    return BIBBLE_HEADER_HEIGHT_18;
  }
  return BIBBLE_HEADER_HEIGHT_14;
}

static int16_t prv_header_time_width(void) {
  if (s_font_size == 24) {
    return BIBBLE_HEADER_TIME_WIDTH_24;
  }
  if (s_font_size == 18) {
    return BIBBLE_HEADER_TIME_WIDTH_18;
  }
  return BIBBLE_HEADER_TIME_WIDTH_14;
}

#if defined(PBL_ROUND)
static int16_t prv_round_header_side_inset(void) {
  if (s_font_size == 24) {
    return BIBBLE_ROUND_HEADER_SIDE_INSET_24;
  }
  if (s_font_size == 18) {
    return BIBBLE_ROUND_HEADER_SIDE_INSET_18;
  }
  return BIBBLE_ROUND_HEADER_SIDE_INSET_14;
}
#endif

static GFont prv_selected_font(void) {
  if (s_font_size == 24) {
    return fonts_get_system_font(s_bold_text ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_24);
  }
  if (s_font_size == 18) {
    return fonts_get_system_font(s_bold_text ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_18);
  }
  return fonts_get_system_font(s_bold_text ? FONT_KEY_GOTHIC_14_BOLD : FONT_KEY_GOTHIC_14);
}

static GFont prv_header_font(void) {
  return prv_selected_font();
}

static GFont prv_reader_font(void) {
  return prv_selected_font();
}

static GFont prv_grid_font(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
}

static void prv_copy_string(char *dest, size_t dest_size, const char *src) {
  if (!dest || dest_size == 0) {
    return;
  }
  snprintf(dest, dest_size, "%s", src ? src : "");
}

static GRect prv_grid_frame_for_bounds(GRect bounds) {
#if defined(PBL_ROUND)
  return GRect(BIBBLE_ROUND_GRID_SIDE_INSET, BIBBLE_ROUND_READER_TOP_INSET,
               bounds.size.w - (BIBBLE_ROUND_GRID_SIDE_INSET * 2),
               bounds.size.h - BIBBLE_ROUND_READER_TOP_INSET - BIBBLE_ROUND_GRID_BOTTOM_GAP);
#else
  int16_t header_height = prv_header_height();
  return GRect(0, header_height, bounds.size.w, bounds.size.h - header_height);
#endif
}

static GRect prv_reader_body_frame_for_bounds(GRect bounds) {
#if defined(PBL_ROUND)
  return GRect(BIBBLE_ROUND_READER_SIDE_INSET, BIBBLE_ROUND_READER_TOP_INSET,
               bounds.size.w - (BIBBLE_ROUND_READER_SIDE_INSET * 2),
               bounds.size.h - BIBBLE_ROUND_READER_TOP_INSET - BIBBLE_ROUND_READER_BOTTOM_GAP);
#else
  int16_t header_height = prv_header_height();
  return GRect(4, header_height + 4, bounds.size.w - 8,
               bounds.size.h - header_height - 8);
#endif
}

static void prv_copy_payload_field(char *dest, size_t dest_size, const char *src) {
  size_t index;

  if (!dest || dest_size == 0) {
    return;
  }
  if (!src) {
    dest[0] = '\0';
    return;
  }

  for (index = 0; index + 1 < dest_size && src[index]; index += 1) {
    char c = src[index];
    dest[index] = (c == '|' || c == '\n' || c == '\r') ? ' ' : c;
  }
  dest[index] = '\0';
}

static const char *prv_next_field(char **cursor) {
  char *start;
  char *separator;

  if (!cursor || !*cursor) {
    return "";
  }

  start = *cursor;
  separator = strchr(start, '|');
  if (separator) {
    *separator = '\0';
    *cursor = separator + 1;
  } else {
    *cursor = NULL;
  }

  return start;
}

static int prv_iabs(int value) {
  return value < 0 ? -value : value;
}

static uint16_t prv_chapter_offset(uint8_t book) {
  return book < BIBBLE_BOOK_COUNT ? BIBBLE_BOOK_CHAPTER_OFFSETS[book] : 0;
}

static uint8_t prv_chapter_count(uint8_t book) {
  return book < BIBBLE_BOOK_COUNT ? BIBBLE_BOOK_CHAPTER_COUNTS[book] : 0;
}

static uint8_t prv_verse_count(uint8_t book, uint8_t chapter) {
  uint16_t index;

  if (book >= BIBBLE_BOOK_COUNT || chapter < 1 || chapter > prv_chapter_count(book)) {
    return 0;
  }

  index = prv_chapter_offset(book) + chapter - 1;
  return BIBBLE_CHAPTER_VERSE_COUNTS[index];
}

static const char *const BIBBLE_BOOK_SHORT_NAMES[BIBBLE_BOOK_COUNT] = {
  "Gen", "Exo", "Lev", "Num", "Deu", "Jos", "Jdg", "Rut", "1Sa", "2Sa", "1Ki", "2Ki",
  "1Ch", "2Ch", "Ezr", "Neh", "Est", "Job", "Psa", "Pro", "Ecc", "Sng", "Isa", "Jer",
  "Lam", "Ezk", "Dan", "Hos", "Joe", "Amo", "Oba", "Jon", "Mic", "Nah", "Hab", "Zep",
  "Hag", "Zec", "Mal", "Mat", "Mrk", "Luk", "Jhn", "Act", "Rom", "1Co", "2Co", "Gal",
  "Eph", "Php", "Col", "1Th", "2Th", "1Ti", "2Ti", "Tit", "Phm", "Heb", "Jas", "1Pe",
  "2Pe", "1Jn", "2Jn", "3Jn", "Jud", "Rev"
};

static void prv_format_chapter_reference(char *dest, size_t dest_size, uint8_t book, uint8_t chapter) {
  if (book >= BIBBLE_BOOK_COUNT) {
    prv_copy_string(dest, dest_size, "");
    return;
  }
  snprintf(dest, dest_size, "%s %u", BIBBLE_BOOK_NAMES[book], chapter);
}

static void prv_header_frames_for_bounds(GRect bounds, GRect *header_frame, GRect *label_frame,
                                         GRect *time_frame) {
  int16_t header_height = prv_header_height();
  int16_t text_height = prv_header_text_height();
  int16_t time_width = prv_header_time_width();
#if defined(PBL_ROUND)
  int16_t text_y = (header_height - text_height) / 2 + 1;
  int16_t side_inset = prv_round_header_side_inset();
  *header_frame = GRect(0, 0, bounds.size.w, header_height);
  *label_frame = GRect(side_inset, text_y,
                       bounds.size.w - (side_inset * 2) - time_width,
                       text_height);
  *time_frame = GRect(bounds.size.w - side_inset - time_width,
                      text_y, time_width, text_height);
#else
  *header_frame = GRect(0, 0, bounds.size.w, header_height);
  *label_frame = GRect(4, 0, bounds.size.w - time_width - 8, text_height);
  *time_frame = GRect(bounds.size.w - time_width - 4, 0, time_width, text_height);
#endif
}

static void prv_create_header(Layer *root, GRect bounds, Layer **header_out, TextLayer **label_out,
                              TextLayer **time_out) {
  GRect header_frame;
  GRect label_frame;
  GRect time_frame;

  prv_header_frames_for_bounds(bounds, &header_frame, &label_frame, &time_frame);

  *header_out = layer_create(header_frame);
  layer_add_child(root, *header_out);

  *label_out = text_layer_create(label_frame);
  text_layer_set_font(*label_out, prv_header_font());
  text_layer_set_overflow_mode(*label_out, GTextOverflowModeTrailingEllipsis);
  text_layer_set_background_color(*label_out, GColorClear);
  text_layer_set_text_color(*label_out, GColorBlack);
  layer_add_child(*header_out, text_layer_get_layer(*label_out));

  *time_out = text_layer_create(time_frame);
  text_layer_set_font(*time_out, prv_header_font());
  text_layer_set_overflow_mode(*time_out, GTextOverflowModeFill);
  text_layer_set_background_color(*time_out, GColorClear);
  text_layer_set_text_color(*time_out, GColorBlack);
  text_layer_set_text_alignment(*time_out, GTextAlignmentRight);
  layer_add_child(*header_out, text_layer_get_layer(*time_out));
}

static void prv_relayout_header(Window *window, Layer *header, TextLayer *label, TextLayer *time_layer) {
  GRect bounds;
  GRect header_frame;
  GRect label_frame;
  GRect time_frame;

  if (!window || !header || !label || !time_layer) {
    return;
  }

  bounds = layer_get_bounds(window_get_root_layer(window));
  prv_header_frames_for_bounds(bounds, &header_frame, &label_frame, &time_frame);
  layer_set_frame(header, header_frame);
  layer_set_frame(text_layer_get_layer(label), label_frame);
  layer_set_frame(text_layer_get_layer(time_layer), time_frame);
  text_layer_set_font(label, prv_header_font());
  text_layer_set_font(time_layer, prv_header_font());
}

static void prv_destroy_header(Layer **header, TextLayer **label, TextLayer **time_layer) {
  if (*label) {
    text_layer_destroy(*label);
    *label = NULL;
  }
  if (*time_layer) {
    text_layer_destroy(*time_layer);
    *time_layer = NULL;
  }
  if (*header) {
    layer_destroy(*header);
    *header = NULL;
  }
}

static void prv_update_header_time(void) {
  time_t now = time(NULL);
  struct tm *local_time = localtime(&now);

  if (!local_time) {
    prv_copy_string(s_header_time, sizeof(s_header_time), "");
  } else if (clock_is_24h_style()) {
    strftime(s_header_time, sizeof(s_header_time), "%H:%M", local_time);
  } else {
    strftime(s_header_time, sizeof(s_header_time), "%I:%M", local_time);
    if (s_header_time[0] == '0') {
      memmove(s_header_time, s_header_time + 1, strlen(s_header_time));
    }
  }

  if (s_book_time_layer) {
    text_layer_set_text(s_book_time_layer, s_header_time);
  }
  if (s_chapter_time_layer) {
    text_layer_set_text(s_chapter_time_layer, s_header_time);
  }
  if (s_verse_time_layer) {
    text_layer_set_text(s_verse_time_layer, s_header_time);
  }
  if (s_reader_time_layer) {
    text_layer_set_text(s_reader_time_layer, s_header_time);
  }
}

static void prv_restore_reader_header(void) {
#if defined(PBL_ROUND)
  if (s_current_book < BIBBLE_BOOK_COUNT) {
    snprintf(s_reader_reference, sizeof(s_reader_reference), "%s %u",
             BIBBLE_BOOK_SHORT_NAMES[s_current_book], s_current_chapter);
  } else {
    prv_copy_string(s_reader_reference, sizeof(s_reader_reference), s_current_reference);
  }
#else
  prv_copy_string(s_reader_reference, sizeof(s_reader_reference), s_current_reference);
#endif

  if (s_reader_reference_layer) {
    text_layer_set_text(s_reader_reference_layer, s_reader_reference);
  }
  prv_update_header_time();
}

static void prv_set_reader_header_label(const char *label) {
  if (s_reader_reference_layer) {
    text_layer_set_text(s_reader_reference_layer, label ? label : "");
  }
}

static void prv_minute_tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  (void)tick_time;
  (void)units_changed;
  prv_update_header_time();
}

static void prv_set_status(const char *status) {
  prv_copy_string(s_status, sizeof(s_status), status);
  prv_update_active_status_layer();
}

static void prv_format_chapter_status(void) {
  if (s_selected_book < BIBBLE_BOOK_COUNT) {
    prv_copy_string(s_chapter_status, sizeof(s_chapter_status), BIBBLE_BOOK_NAMES[s_selected_book]);
  } else {
    prv_copy_string(s_chapter_status, sizeof(s_chapter_status), "Select a chapter");
  }
}

static void prv_format_verse_status(void) {
  if (s_selected_book < BIBBLE_BOOK_COUNT && s_selected_chapter >= 1 &&
      s_selected_chapter <= prv_chapter_count(s_selected_book)) {
    snprintf(s_verse_status, sizeof(s_verse_status), "%s %u", BIBBLE_BOOK_NAMES[s_selected_book],
             s_selected_chapter);
  } else {
    prv_copy_string(s_verse_status, sizeof(s_verse_status), "Select a verse");
  }
}

static void prv_update_status_layers(void) {
  if (s_book_status_layer) {
    text_layer_set_text(s_book_status_layer, "Select a book");
  }
  if (s_chapter_status_layer) {
    prv_format_chapter_status();
    text_layer_set_text(s_chapter_status_layer, s_chapter_status);
  }
  if (s_verse_status_layer) {
    prv_format_verse_status();
    text_layer_set_text(s_verse_status_layer, s_verse_status);
  }
}

static void prv_update_active_status_layer(void) {
  Window *top = window_stack_get_top_window();

  if (top == s_book_window && s_book_status_layer) {
    text_layer_set_text(s_book_status_layer, s_status);
  } else if (top == s_chapter_window && s_chapter_status_layer) {
    text_layer_set_text(s_chapter_status_layer, s_status);
  } else if (top == s_verse_window && s_verse_status_layer) {
    text_layer_set_text(s_verse_status_layer, s_status);
  }
}

static void prv_remove_outbox_message(uint8_t index) {
  uint8_t next;

  if (index >= s_outbox_count) {
    return;
  }
  for (next = index + 1; next < s_outbox_count; next += 1) {
    s_outbox_queue[next - 1] = s_outbox_queue[next];
  }
  s_outbox_count -= 1;
}

static void prv_remove_queued_prefetch(void) {
  uint8_t index = s_outbox_busy ? 1 : 0;

  while (index < s_outbox_count) {
    if (s_outbox_queue[index].prefetch) {
      prv_remove_outbox_message(index);
      s_prefetch_in_flight = false;
    } else {
      index += 1;
    }
  }
}

static void prv_remove_queued_page_requests(void) {
  uint8_t index = s_outbox_busy ? 1 : 0;

  while (index < s_outbox_count) {
    if (strcmp(s_outbox_queue[index].type, BIBBLE_MSG_PAGE_REQUEST) == 0) {
      prv_remove_outbox_message(index);
    } else {
      index += 1;
    }
  }
}

static void prv_cancel_page_response_timer(void) {
  if (s_page_response_timer) {
    app_timer_cancel(s_page_response_timer);
    s_page_response_timer = NULL;
  }
}

static void prv_outbox_retry_timer_callback(void *context) {
  (void)context;
  s_outbox_retry_timer = NULL;
  prv_flush_outbox_queue();
}

static void prv_schedule_outbox_retry(void) {
  if (!s_outbox_retry_timer) {
    s_outbox_retry_timer = app_timer_register(BIBBLE_OUTBOX_RETRY_MS, prv_outbox_retry_timer_callback, NULL);
  }
}

static void prv_report_outbox_failure(bool prefetch, bool report_error) {
  if (prefetch) {
    s_prefetch_in_flight = false;
    return;
  }
  if (report_error) {
    prv_cancel_page_response_timer();
    s_reader_loading = false;
    prv_set_status("Phone link failed");
    prv_set_reader_header_label(s_status);
  }
}

static void prv_finish_outbox_message(bool sent) {
  bool prefetch;
  bool report_error;

  if (!s_outbox_count) {
    s_outbox_busy = false;
    return;
  }

  prefetch = s_outbox_queue[0].prefetch;
  report_error = s_outbox_queue[0].report_error;
  prv_remove_outbox_message(0);
  s_outbox_busy = false;
  if (!sent) {
    prv_report_outbox_failure(prefetch, report_error);
  }
  prv_flush_outbox_queue();
}

static bool prv_enqueue_outbox_message(const char *type, const char *payload, bool report_error) {
  bool prefetch = type && strcmp(type, BIBBLE_MSG_PREFETCH_REQUEST) == 0;
  uint8_t first_queued = s_outbox_busy ? 1 : 0;
  uint8_t index;
  BibbleOutgoingMessage *message;

  if (!prefetch) {
    prv_remove_queued_prefetch();

    // Only the newest unsent page request matters.
    if (type && strcmp(type, BIBBLE_MSG_PAGE_REQUEST) == 0) {
      for (index = first_queued; index < s_outbox_count; index += 1) {
        if (strcmp(s_outbox_queue[index].type, BIBBLE_MSG_PAGE_REQUEST) == 0) {
          prv_copy_string(s_outbox_queue[index].payload, sizeof(s_outbox_queue[index].payload), payload);
          prv_flush_outbox_queue();
          return true;
        }
      }
    }
  }

  if (s_outbox_count >= BIBBLE_OUTBOX_QUEUE_SIZE) {
    if (report_error) {
      s_reader_loading = false;
      prv_set_status("Phone queue full");
      prv_set_reader_header_label(s_status);
    }
    return false;
  }

  message = &s_outbox_queue[s_outbox_count];
  message->report_error = report_error;
  message->prefetch = prefetch;
  prv_copy_string(message->type, sizeof(message->type), type);
  prv_copy_string(message->payload, sizeof(message->payload), payload);
  s_outbox_count += 1;
  prv_flush_outbox_queue();
  return true;
}

static void prv_flush_outbox_queue(void) {
  DictionaryIterator *iter;
  AppMessageResult result;

  if (s_outbox_busy || !s_outbox_count) {
    return;
  }

  result = app_message_outbox_begin(&iter);
  if (result == APP_MSG_BUSY) {
    prv_schedule_outbox_retry();
    return;
  }
  if (result != APP_MSG_OK || !iter) {
    prv_finish_outbox_message(false);
    return;
  }

  dict_write_cstring(iter, MESSAGE_KEY_MessageType, s_outbox_queue[0].type);
  dict_write_cstring(iter, MESSAGE_KEY_Payload, s_outbox_queue[0].payload);
  s_outbox_busy = true;
  result = app_message_outbox_send();
  if (result == APP_MSG_BUSY) {
    s_outbox_busy = false;
    prv_schedule_outbox_retry();
  } else if (result != APP_MSG_OK) {
    s_outbox_busy = false;
    prv_finish_outbox_message(false);
  }
}

static bool prv_send_message_internal(const char *type, const char *payload, bool report_error) {
  return prv_enqueue_outbox_message(type, payload, report_error);
}

static bool prv_send_message(const char *type, const char *payload) {
  return prv_send_message_internal(type, payload, true);
}

static BibbleCachedPage *prv_cache_find(uint8_t book, uint8_t chapter, uint16_t page) {
  uint8_t index;

  for (index = 0; index < BIBBLE_PAGE_CACHE_SIZE; index += 1) {
    BibbleCachedPage *entry = &s_page_cache[index];
    if (entry->valid && entry->book == book && entry->chapter == chapter && entry->page == page) {
      entry->last_used = ++s_page_cache_clock;
      return entry;
    }
  }
  return NULL;
}

static void prv_cache_clear(void) {
  memset(s_page_cache, 0, sizeof(s_page_cache));
  s_page_cache_clock = 0;
}

static BibbleCachedPage *prv_cache_store(uint8_t book, uint8_t chapter, uint8_t verse, uint16_t page,
                                         uint16_t page_count, const char *text) {
  BibbleCachedPage *entry = NULL;
  uint8_t index;

  for (index = 0; index < BIBBLE_PAGE_CACHE_SIZE; index += 1) {
    BibbleCachedPage *candidate = &s_page_cache[index];
    if (candidate->valid && candidate->book == book && candidate->chapter == chapter && candidate->page == page) {
      entry = candidate;
      break;
    }
  }

  if (!entry) {
    for (index = 0; index < BIBBLE_PAGE_CACHE_SIZE; index += 1) {
      BibbleCachedPage *candidate = &s_page_cache[index];
      if (!candidate->valid) {
        entry = candidate;
        break;
      }
      if (!entry || candidate->last_used < entry->last_used) {
        entry = candidate;
      }
    }
  }

  if (!entry) {
    return NULL;
  }

  entry->valid = true;
  entry->book = book;
  entry->chapter = chapter;
  entry->verse = verse ? verse : 1;
  entry->page = page ? page : 1;
  entry->page_count = page_count ? page_count : 1;
  entry->last_used = ++s_page_cache_clock;
  prv_copy_string(entry->text, sizeof(entry->text), text && text[0] ? text : "No text");
  return entry;
}

static BibbleCachedPage *prv_cache_find_adjacent(uint8_t book, uint8_t chapter, uint16_t page,
                                                  uint16_t page_count, int direction) {
  uint8_t adjacent_book = book;
  uint8_t adjacent_chapter = chapter;
  uint8_t index;

  if (direction > 0) {
    if (page < page_count) {
      return prv_cache_find(book, chapter, page + 1);
    }
    if (chapter < prv_chapter_count(book)) {
      adjacent_chapter += 1;
    } else if (book + 1 < BIBBLE_BOOK_COUNT) {
      adjacent_book += 1;
      adjacent_chapter = 1;
    } else {
      return NULL;
    }
    return prv_cache_find(adjacent_book, adjacent_chapter, 1);
  }

  if (page > 1) {
    return prv_cache_find(book, chapter, page - 1);
  }
  if (chapter > 1) {
    adjacent_chapter -= 1;
  } else if (book > 0) {
    adjacent_book -= 1;
    adjacent_chapter = prv_chapter_count(adjacent_book);
  } else {
    return NULL;
  }

  for (index = 0; index < BIBBLE_PAGE_CACHE_SIZE; index += 1) {
    BibbleCachedPage *entry = &s_page_cache[index];
    if (entry->valid && entry->book == adjacent_book && entry->chapter == adjacent_chapter &&
        entry->page == entry->page_count) {
      entry->last_used = ++s_page_cache_clock;
      return entry;
    }
  }
  return NULL;
}

static void prv_apply_cached_page(BibbleCachedPage *entry) {
  if (!entry || !entry->valid) {
    return;
  }

  if (window_stack_get_top_window() != s_reader_window) {
    prv_show_reader_window(entry->book, entry->chapter, entry->verse, false);
  }

  s_current_book = entry->book;
  s_current_chapter = entry->chapter;
  s_current_verse = entry->verse;
  s_current_page = entry->page;
  s_page_count = entry->page_count;
  s_reader_loading = false;
  entry->last_used = ++s_page_cache_clock;
  prv_format_chapter_reference(s_current_reference, sizeof(s_current_reference), entry->book, entry->chapter);
  prv_copy_string(s_reader_text, sizeof(s_reader_text), entry->text);
  prv_update_reader_layers(true);
  prv_start_prefetch();
}

static bool prv_show_cached_adjacent(int direction) {
  BibbleCachedPage *entry = prv_cache_find_adjacent(s_current_book, s_current_chapter, s_current_page,
                                                     s_page_count, direction);
  if (!entry) {
    return false;
  }
  prv_apply_cached_page(entry);
  return true;
}

static void prv_set_cursor_from_page(BibblePageCursor *cursor, const BibbleCachedPage *entry) {
  if (!cursor || !entry) {
    return;
  }
  cursor->book = entry->book;
  cursor->chapter = entry->chapter;
  cursor->page = entry->page;
  cursor->page_count = entry->page_count;
}

static bool prv_cursor_is_boundary(const BibblePageCursor *cursor, int direction) {
  if (direction > 0) {
    return cursor->book + 1 == BIBBLE_BOOK_COUNT &&
           cursor->chapter == prv_chapter_count(cursor->book) && cursor->page >= cursor->page_count;
  }
  return cursor->book == 0 && cursor->chapter == 1 && cursor->page <= 1;
}

static void prv_continue_prefetch(void) {
  while (s_prefetch_step < BIBBLE_PREFETCH_STEP_COUNT) {
    BibbleCachedPage *cached;
    BibblePageCursor *cursor;
    char payload[64];
    int direction = BIBBLE_PREFETCH_DIRECTIONS[s_prefetch_step];

    cursor = direction > 0 ? &s_prefetch_forward_cursor : &s_prefetch_backward_cursor;
    if (prv_cursor_is_boundary(cursor, direction)) {
      s_prefetch_step += 1;
      continue;
    }

    cached = prv_cache_find_adjacent(cursor->book, cursor->chapter, cursor->page, cursor->page_count, direction);
    if (cached) {
      prv_set_cursor_from_page(cursor, cached);
      s_prefetch_step += 1;
      continue;
    }

    snprintf(payload, sizeof(payload), "%u|%u|%u|%d|%u", cursor->book, cursor->chapter,
             cursor->page, direction, s_prefetch_generation);
    if (prv_send_message_internal(BIBBLE_MSG_PREFETCH_REQUEST, payload, false)) {
      s_prefetch_direction = direction;
      s_prefetch_in_flight = true;
    }
    return;
  }
  s_prefetch_in_flight = false;
}

static void prv_start_prefetch(void) {
  s_prefetch_generation += 1;
  if (!s_prefetch_generation) {
    s_prefetch_generation = 1;
  }
  s_prefetch_step = 0;
  s_prefetch_in_flight = false;
  s_prefetch_forward_cursor = (BibblePageCursor) {
    .book = s_current_book,
    .chapter = s_current_chapter,
    .page = s_current_page,
    .page_count = s_page_count,
  };
  s_prefetch_backward_cursor = s_prefetch_forward_cursor;
  prv_continue_prefetch();
}

static void prv_ready_timer_callback(void *context) {
  (void)context;
  s_ready_timer = NULL;
  prv_send_message(BIBBLE_MSG_READY, "");
}

static void prv_invalidate_page_request(void) {
  s_page_request_generation += 1;
  if (!s_page_request_generation) {
    s_page_request_generation = 1;
  }
}

static void prv_page_response_timeout_callback(void *context) {
  (void)context;
  s_page_response_timer = NULL;
  prv_remove_queued_page_requests();
  prv_invalidate_page_request();
  s_reader_loading = false;
  prv_set_status("Phone response timed out");
  prv_set_reader_header_label(s_status);
}

static void prv_start_page_response_timer(void) {
  prv_cancel_page_response_timer();
  s_page_response_timer = app_timer_register(BIBBLE_PAGE_RESPONSE_TIMEOUT_MS,
                                             prv_page_response_timeout_callback, NULL);
}

static void prv_request_page(uint8_t book, uint8_t chapter, uint8_t verse, uint16_t page) {
  char payload[48];

  s_prefetch_generation += 1;
  s_prefetch_in_flight = false;
  s_reader_loading = true;
  prv_invalidate_page_request();

  snprintf(payload, sizeof(payload), "%u|%u|%u|%u|%u", book, chapter, verse, page,
           s_page_request_generation);
  if (prv_send_message(BIBBLE_MSG_PAGE_REQUEST, payload)) {
    prv_start_page_response_timer();
  }
}

static void prv_page_request_timer_callback(void *context) {
  (void)context;
  s_page_request_timer = NULL;
  prv_request_page(s_pending_page_book, s_pending_page_chapter, s_pending_page_verse, s_pending_page);
}

static void prv_schedule_page_request(uint8_t book, uint8_t chapter, uint8_t verse, uint16_t page) {
  if (s_page_request_timer) {
    app_timer_cancel(s_page_request_timer);
    s_page_request_timer = NULL;
  }

  s_pending_page_book = book;
  s_pending_page_chapter = chapter;
  s_pending_page_verse = verse;
  s_pending_page = page;
  s_page_request_timer = app_timer_register(BIBBLE_PAGE_REQUEST_DELAY_MS, prv_page_request_timer_callback, NULL);
}

static void prv_cancel_page_request(void) {
  if (s_page_request_timer) {
    app_timer_cancel(s_page_request_timer);
    s_page_request_timer = NULL;
  }
  prv_remove_queued_page_requests();
  prv_cancel_page_response_timer();
  prv_invalidate_page_request();
  s_reader_loading = false;
}

static void prv_request_next_page(void) {
  uint8_t book = s_current_book;
  uint8_t chapter = s_current_chapter;

  if (s_reader_loading) {
    return;
  }
  if (prv_show_cached_adjacent(1)) {
    return;
  }
  if (s_current_page < s_page_count) {
    prv_request_page(book, chapter, 0, s_current_page + 1);
    return;
  }
  if (chapter < prv_chapter_count(book)) {
    prv_request_page(book, chapter + 1, 1, 1);
    return;
  }
  if (book + 1 < BIBBLE_BOOK_COUNT) {
    prv_request_page(book + 1, 1, 1, 1);
    return;
  }
  prv_set_reader_header_label("End");
}

static void prv_request_previous_page(void) {
  uint8_t book = s_current_book;
  uint8_t chapter = s_current_chapter;

  if (s_reader_loading) {
    return;
  }
  if (prv_show_cached_adjacent(-1)) {
    return;
  }
  if (s_current_page > 1) {
    prv_request_page(book, chapter, 0, s_current_page - 1);
    return;
  }
  if (chapter > 1) {
    prv_request_page(book, chapter - 1, 0, 999);
    return;
  }
  if (book > 0) {
    book -= 1;
    prv_request_page(book, prv_chapter_count(book), 0, 999);
    return;
  }
  prv_set_reader_header_label("Beginning");
}

static uint16_t prv_grid_item_count(BibbleGridKind kind) {
  switch (kind) {
    case BibbleGridKindBook:
      return BIBBLE_BOOK_COUNT;
    case BibbleGridKindChapter:
      return prv_chapter_count(s_selected_book);
    case BibbleGridKindVerse:
      return prv_verse_count(s_selected_book, s_selected_chapter);
    default:
      return 0;
  }
}

static uint16_t prv_grid_selected_index(BibbleGridKind kind) {
  switch (kind) {
    case BibbleGridKindBook:
      return s_selected_book;
    case BibbleGridKindChapter:
      return s_selected_chapter_index;
    case BibbleGridKindVerse:
      return s_selected_verse_index;
    default:
      return 0;
  }
}

static void prv_grid_set_selected_index(BibbleGridKind kind, uint16_t index) {
  switch (kind) {
    case BibbleGridKindBook:
      s_selected_book = (uint8_t)index;
      break;
    case BibbleGridKindChapter:
      s_selected_chapter_index = index;
      s_selected_chapter = (uint8_t)(index + 1);
      break;
    case BibbleGridKindVerse:
      s_selected_verse_index = index;
      break;
    default:
      break;
  }
}

static ScrollLayer *prv_grid_scroll_layer(BibbleGridKind kind) {
  switch (kind) {
    case BibbleGridKindBook:
      return s_book_scroll_layer;
    case BibbleGridKindChapter:
      return s_chapter_scroll_layer;
    case BibbleGridKindVerse:
      return s_verse_scroll_layer;
    default:
      return NULL;
  }
}

static Layer *prv_grid_content_layer(BibbleGridKind kind) {
  switch (kind) {
    case BibbleGridKindBook:
      return s_book_grid_layer;
    case BibbleGridKindChapter:
      return s_chapter_grid_layer;
    case BibbleGridKindVerse:
      return s_verse_grid_layer;
    default:
      return NULL;
  }
}

static int prv_grid_content_height(BibbleGridKind kind, int viewport_height) {
  uint16_t rows = (prv_grid_item_count(kind) + BIBBLE_GRID_COLUMNS - 1) / BIBBLE_GRID_COLUMNS;
  int content_height = rows * prv_grid_cell_height();

  return content_height < viewport_height ? viewport_height : content_height;
}

static int prv_clamp_grid_offset(BibbleGridKind kind, int offset_y) {
  ScrollLayer *scroll_layer = prv_grid_scroll_layer(kind);
  Layer *scroll_root;
  GRect bounds;
  GSize content_size;
  int min_y;

  if (!scroll_layer) {
    return offset_y;
  }

  scroll_root = scroll_layer_get_layer(scroll_layer);
  bounds = layer_get_bounds(scroll_root);
  content_size = scroll_layer_get_content_size(scroll_layer);
  min_y = bounds.size.h - content_size.h;
  if (min_y > 0) {
    min_y = 0;
  }
  if (offset_y > 0) {
    return 0;
  }
  if (offset_y < min_y) {
    return min_y;
  }
  return offset_y;
}

static void prv_grid_ensure_selected_visible(BibbleGridKind kind, bool animated) {
  ScrollLayer *scroll_layer = prv_grid_scroll_layer(kind);
  Layer *scroll_root;
  GRect bounds;
  GPoint offset;
  uint16_t selected = prv_grid_selected_index(kind);
  int cell_top;
  int cell_bottom;
  int viewport_top;
  int viewport_bottom;
  int next_y;
  int cell_height = prv_grid_cell_height();

  if (!scroll_layer || selected >= prv_grid_item_count(kind)) {
    return;
  }

  scroll_root = scroll_layer_get_layer(scroll_layer);
  bounds = layer_get_bounds(scroll_root);
  offset = scroll_layer_get_content_offset(scroll_layer);
  cell_top = (selected / BIBBLE_GRID_COLUMNS) * cell_height;
  cell_bottom = cell_top + cell_height;
  viewport_top = -offset.y;
  viewport_bottom = viewport_top + bounds.size.h;
  next_y = offset.y;

  if (cell_top < viewport_top) {
    next_y = -cell_top;
  } else if (cell_bottom > viewport_bottom) {
    next_y = -(cell_bottom - bounds.size.h);
  }

  scroll_layer_set_content_offset(scroll_layer, GPoint(0, prv_clamp_grid_offset(kind, next_y)), animated);
}

static void prv_grid_reload(BibbleGridKind kind) {
  ScrollLayer *scroll_layer = prv_grid_scroll_layer(kind);
  Layer *grid_layer = prv_grid_content_layer(kind);
  Layer *scroll_root;
  GRect bounds;
  GRect frame;
  int content_height;

  if (!scroll_layer || !grid_layer) {
    return;
  }

  scroll_root = scroll_layer_get_layer(scroll_layer);
  bounds = layer_get_bounds(scroll_root);
  content_height = prv_grid_content_height(kind, bounds.size.h);
  frame = GRect(0, 0, bounds.size.w, content_height);
  layer_set_frame(grid_layer, frame);
  scroll_layer_set_content_size(scroll_layer, GSize(bounds.size.w, content_height));
  layer_mark_dirty(grid_layer);
  prv_grid_ensure_selected_visible(kind, false);
}

static const char *prv_grid_item_label(BibbleGridKind kind, uint16_t index, char *buffer, size_t buffer_size) {
  if (kind == BibbleGridKindBook) {
    return index < BIBBLE_BOOK_COUNT ? BIBBLE_BOOK_SHORT_NAMES[index] : "";
  }

  snprintf(buffer, buffer_size, "%u", (unsigned int)(index + 1));
  return buffer;
}

static void prv_grid_draw(BibbleGridKind kind, Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  GFont font = prv_grid_font();
  int16_t cell_height = prv_grid_cell_height();
  uint16_t count = prv_grid_item_count(kind);
  uint16_t selected = prv_grid_selected_index(kind);
  ScrollLayer *scroll_layer = prv_grid_scroll_layer(kind);
  int visible_top = 0;
  int visible_bottom = bounds.size.h;
  uint16_t first_index;
  uint16_t last_index;
  uint16_t index;

  if (scroll_layer) {
    GPoint offset = scroll_layer_get_content_offset(scroll_layer);
    GRect scroll_bounds = layer_get_bounds(scroll_layer_get_layer(scroll_layer));
    visible_top = -offset.y;
    visible_bottom = visible_top + scroll_bounds.size.h;
  }

  if (visible_top < 0) {
    visible_top = 0;
  }
  if (visible_bottom > bounds.size.h) {
    visible_bottom = bounds.size.h;
  }
  if (visible_bottom < visible_top) {
    visible_bottom = visible_top;
  }

  first_index = (visible_top / cell_height) * BIBBLE_GRID_COLUMNS;
  last_index = ((visible_bottom + cell_height - 1) / cell_height) *
               BIBBLE_GRID_COLUMNS;
  if (last_index > count) {
    last_index = count;
  }

  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, GRect(0, visible_top, bounds.size.w, visible_bottom - visible_top), 0, GCornerNone);

  for (index = first_index; index < last_index; index += 1) {
    char label[8];
    uint8_t col = index % BIBBLE_GRID_COLUMNS;
    uint16_t row = index / BIBBLE_GRID_COLUMNS;
    int16_t cell_top = row * cell_height;
    int16_t x = (bounds.size.w * col) / BIBBLE_GRID_COLUMNS;
    int16_t next_x = (bounds.size.w * (col + 1)) / BIBBLE_GRID_COLUMNS;
    GRect cell = GRect(x, cell_top, next_x - x, cell_height);
    GRect text_frame = GRect(cell.origin.x + 1, cell.origin.y + 2, cell.size.w - 2, cell.size.h - 4);
    bool is_selected = index == selected;

    if (is_selected) {
      graphics_context_set_fill_color(ctx, GColorBlack);
      graphics_fill_rect(ctx, cell, 0, GCornerNone);
      graphics_context_set_stroke_color(ctx, GColorWhite);
      graphics_context_set_text_color(ctx, GColorWhite);
    } else {
      graphics_context_set_stroke_color(ctx, GColorBlack);
      graphics_context_set_text_color(ctx, GColorBlack);
    }

    graphics_draw_rect(ctx, cell);
    graphics_draw_text(ctx, prv_grid_item_label(kind, index, label, sizeof(label)), font, text_frame,
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }
}

static void prv_book_grid_update_proc(Layer *layer, GContext *ctx) {
  prv_grid_draw(BibbleGridKindBook, layer, ctx);
}

static void prv_chapter_grid_update_proc(Layer *layer, GContext *ctx) {
  prv_grid_draw(BibbleGridKindChapter, layer, ctx);
}

static void prv_verse_grid_update_proc(Layer *layer, GContext *ctx) {
  prv_grid_draw(BibbleGridKindVerse, layer, ctx);
}

static void prv_grid_window_load_common(Window *window, BibbleGridKind kind, ScrollLayer **scroll_out,
                                        Layer **grid_out, Layer **header_out, TextLayer **status_out,
                                        TextLayer **time_out, LayerUpdateProc update_proc) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  GRect grid_frame = prv_grid_frame_for_bounds(bounds);
  int content_height = prv_grid_content_height(kind, grid_frame.size.h);

  window_set_background_color(window, GColorWhite);
  prv_create_header(root, bounds, header_out, status_out, time_out);

  *scroll_out = scroll_layer_create(grid_frame);
  scroll_layer_set_shadow_hidden(*scroll_out, true);
  layer_set_clips(scroll_layer_get_layer(*scroll_out), true);
  layer_add_child(root, scroll_layer_get_layer(*scroll_out));

  *grid_out = layer_create(GRect(0, 0, grid_frame.size.w, content_height));
  layer_set_update_proc(*grid_out, update_proc);
  scroll_layer_set_content_size(*scroll_out, GSize(grid_frame.size.w, content_height));
  scroll_layer_add_child(*scroll_out, *grid_out);

  window_set_click_config_provider(window, prv_grid_click_config_provider);
  prv_update_status_layers();
  prv_update_header_time();
  prv_grid_ensure_selected_visible(kind, false);
}

static void prv_grid_window_unload_common(ScrollLayer **scroll_layer, Layer **grid_layer, Layer **header_layer,
                                          TextLayer **status_layer, TextLayer **time_layer) {
  if (*grid_layer) {
    layer_destroy(*grid_layer);
    *grid_layer = NULL;
  }
  if (*scroll_layer) {
    scroll_layer_destroy(*scroll_layer);
    *scroll_layer = NULL;
  }
  prv_destroy_header(header_layer, status_layer, time_layer);
}

static void prv_book_window_load(Window *window) {
  prv_grid_window_load_common(window, BibbleGridKindBook, &s_book_scroll_layer, &s_book_grid_layer,
                              &s_book_header_layer, &s_book_status_layer, &s_book_time_layer,
                              prv_book_grid_update_proc);

  if (!s_touch_subscribed) {
    touch_service_subscribe(prv_touch_handler, NULL);
    s_touch_subscribed = true;
  }
}

static void prv_book_window_appear(Window *window) {
  (void)window;
  prv_update_status_layers();
}

static void prv_book_window_unload(Window *window) {
  (void)window;
  if (s_touch_subscribed) {
    touch_service_unsubscribe();
    s_touch_subscribed = false;
  }
  prv_grid_window_unload_common(&s_book_scroll_layer, &s_book_grid_layer, &s_book_header_layer,
                                &s_book_status_layer, &s_book_time_layer);
}

static void prv_chapter_window_load(Window *window) {
  prv_grid_window_load_common(window, BibbleGridKindChapter, &s_chapter_scroll_layer, &s_chapter_grid_layer,
                              &s_chapter_header_layer, &s_chapter_status_layer, &s_chapter_time_layer,
                              prv_chapter_grid_update_proc);
}

static void prv_chapter_window_appear(Window *window) {
  (void)window;
  prv_update_status_layers();
}

static void prv_chapter_window_unload(Window *window) {
  (void)window;
  prv_grid_window_unload_common(&s_chapter_scroll_layer, &s_chapter_grid_layer, &s_chapter_header_layer,
                                &s_chapter_status_layer, &s_chapter_time_layer);
}

static void prv_verse_window_load(Window *window) {
  prv_grid_window_load_common(window, BibbleGridKindVerse, &s_verse_scroll_layer, &s_verse_grid_layer,
                              &s_verse_header_layer, &s_verse_status_layer, &s_verse_time_layer,
                              prv_verse_grid_update_proc);
}

static void prv_verse_window_appear(Window *window) {
  (void)window;
  prv_update_status_layers();
}

static void prv_verse_window_unload(Window *window) {
  (void)window;
  prv_grid_window_unload_common(&s_verse_scroll_layer, &s_verse_grid_layer, &s_verse_header_layer,
                                &s_verse_status_layer, &s_verse_time_layer);
}

static void prv_show_chapter_window(uint8_t book, uint8_t chapter) {
  Window *top = window_stack_get_top_window();
  uint8_t chapter_count;

  if (book >= BIBBLE_BOOK_COUNT) {
    return;
  }

  chapter_count = prv_chapter_count(book);
  if (chapter < 1) {
    chapter = 1;
  } else if (chapter > chapter_count) {
    chapter = chapter_count;
  }

  s_selected_book = book;
  s_selected_chapter = chapter;
  s_selected_chapter_index = chapter - 1;
  s_selected_verse_index = 0;
  prv_update_status_layers();

  if (!s_chapter_window) {
    s_chapter_window = window_create();
    window_set_window_handlers(s_chapter_window, (WindowHandlers){
      .load = prv_chapter_window_load,
      .appear = prv_chapter_window_appear,
      .unload = prv_chapter_window_unload,
    });
  }

  if (top == s_reader_window) {
    window_stack_pop(false);
    top = window_stack_get_top_window();
  }
  if (top == s_verse_window) {
    window_stack_pop(false);
    top = window_stack_get_top_window();
  }
  if (top != s_chapter_window) {
    window_stack_push(s_chapter_window, true);
  } else {
    prv_grid_reload(BibbleGridKindChapter);
  }
}

static void prv_show_verse_window(uint8_t book, uint8_t chapter, uint8_t verse) {
  Window *top = window_stack_get_top_window();
  uint8_t verse_count;

  if (book >= BIBBLE_BOOK_COUNT || chapter < 1 || chapter > prv_chapter_count(book)) {
    return;
  }

  s_selected_book = book;
  s_selected_chapter = chapter;
  s_selected_chapter_index = chapter - 1;
  verse_count = prv_verse_count(book, chapter);
  if (verse < 1) {
    verse = 1;
  } else if (verse > verse_count) {
    verse = verse_count;
  }
  s_selected_verse_index = verse - 1;
  prv_update_status_layers();

  if (!s_verse_window) {
    s_verse_window = window_create();
    window_set_window_handlers(s_verse_window, (WindowHandlers){
      .load = prv_verse_window_load,
      .appear = prv_verse_window_appear,
      .unload = prv_verse_window_unload,
    });
  }

  if (top == s_reader_window) {
    window_stack_pop(false);
    top = window_stack_get_top_window();
  }
  if (top != s_verse_window) {
    window_stack_push(s_verse_window, true);
  } else {
    prv_grid_reload(BibbleGridKindVerse);
  }
}

static void prv_update_reader_layers(bool reset_scroll) {
  Layer *body_layer;
  Layer *scroll_layer;
  GRect scroll_bounds;
  GRect body_frame;
  GSize text_size;
  int16_t content_height;

  if (!s_reader_scroll_layer || !s_reader_body_layer) {
    return;
  }

  text_layer_set_text(s_reader_body_layer, s_reader_text);

  body_layer = text_layer_get_layer(s_reader_body_layer);
  scroll_layer = scroll_layer_get_layer(s_reader_scroll_layer);
  scroll_bounds = layer_get_bounds(scroll_layer);
  body_frame = layer_get_frame(body_layer);
  body_frame.origin = GPointZero;
  body_frame.size.w = scroll_bounds.size.w;
  body_frame.size.h = BIBBLE_READER_TEXT_MEASURE_HEIGHT;
  layer_set_frame(body_layer, body_frame);

  text_size = text_layer_get_content_size(s_reader_body_layer);
  content_height = text_size.h + BIBBLE_READER_TEXT_PADDING;
  if (content_height < scroll_bounds.size.h) {
    content_height = scroll_bounds.size.h;
  }

  body_frame.size.h = content_height;
  layer_set_frame(body_layer, body_frame);
  scroll_layer_set_content_size(s_reader_scroll_layer, GSize(scroll_bounds.size.w, content_height));
  if (reset_scroll) {
    scroll_layer_set_content_offset(s_reader_scroll_layer, GPointZero, false);
  }

  prv_restore_reader_header();
}

static bool prv_replace_reader_body_layer(GSize size) {
  TextLayer *old_layer = s_reader_body_layer;
  TextLayer *new_layer;

  if (!s_reader_scroll_layer) {
    return false;
  }

  new_layer = text_layer_create(GRect(0, 0, size.w, size.h));
  if (!new_layer) {
    return false;
  }

  text_layer_set_font(new_layer, prv_reader_font());
  text_layer_set_overflow_mode(new_layer, GTextOverflowModeWordWrap);
  text_layer_set_background_color(new_layer, GColorClear);
  scroll_layer_add_child(s_reader_scroll_layer, text_layer_get_layer(new_layer));
  s_reader_body_layer = new_layer;

  if (old_layer) {
    text_layer_destroy(old_layer);
  }
  return true;
}

static void prv_reader_window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  GRect body_frame = prv_reader_body_frame_for_bounds(bounds);

  window_set_background_color(window, GColorWhite);
  prv_create_header(root, bounds, &s_reader_header_layer, &s_reader_reference_layer, &s_reader_time_layer);

  s_reader_scroll_layer = scroll_layer_create(body_frame);
  scroll_layer_set_shadow_hidden(s_reader_scroll_layer, true);
  layer_set_clips(scroll_layer_get_layer(s_reader_scroll_layer), true);
  scroll_layer_set_callbacks(s_reader_scroll_layer, (ScrollLayerCallbacks) {
    .click_config_provider = prv_reader_click_config_provider,
  });
  scroll_layer_set_click_config_onto_window(s_reader_scroll_layer, window);
  layer_add_child(root, scroll_layer_get_layer(s_reader_scroll_layer));

  prv_replace_reader_body_layer(body_frame.size);

  prv_update_reader_layers(true);
}

static void prv_relayout_grid_window(Window *window, BibbleGridKind kind, Layer *header,
                                     TextLayer *label, TextLayer *time_layer) {
  ScrollLayer *scroll_layer = prv_grid_scroll_layer(kind);
  GRect bounds;
  GRect frame;

  prv_relayout_header(window, header, label, time_layer);
  if (!window || !scroll_layer) {
    return;
  }

  bounds = layer_get_bounds(window_get_root_layer(window));
  frame = prv_grid_frame_for_bounds(bounds);
  layer_set_frame(scroll_layer_get_layer(scroll_layer), frame);
  prv_grid_reload(kind);
}

static void prv_relayout_for_font_profile(void) {
  GRect bounds;
  GRect body_frame;

  prv_relayout_grid_window(s_book_window, BibbleGridKindBook, s_book_header_layer,
                           s_book_status_layer, s_book_time_layer);
  prv_relayout_grid_window(s_chapter_window, BibbleGridKindChapter, s_chapter_header_layer,
                           s_chapter_status_layer, s_chapter_time_layer);
  prv_relayout_grid_window(s_verse_window, BibbleGridKindVerse, s_verse_header_layer,
                           s_verse_status_layer, s_verse_time_layer);

  prv_relayout_header(s_reader_window, s_reader_header_layer, s_reader_reference_layer,
                      s_reader_time_layer);
  if (!s_reader_window || !s_reader_scroll_layer || !s_reader_body_layer) {
    return;
  }

  bounds = layer_get_bounds(window_get_root_layer(s_reader_window));
  body_frame = prv_reader_body_frame_for_bounds(bounds);
  layer_set_frame(scroll_layer_get_layer(s_reader_scroll_layer), body_frame);
  prv_replace_reader_body_layer(body_frame.size);
  prv_update_reader_layers(true);
}

static bool prv_valid_font_size(uint8_t font_size) {
  return font_size == 14 || font_size == 18 || font_size == 24;
}

static bool prv_parse_font_profile(const char *value, uint8_t *font_size_out, bool *bold_out) {
  uint8_t font_size;

  if (!value || !font_size_out || !bold_out) {
    return false;
  }
  if (strcmp(value, "normal") == 0) {
    *font_size_out = 14;
    *bold_out = false;
    return true;
  }
  if (strcmp(value, "large") == 0) {
    *font_size_out = 18;
    *bold_out = true;
    return true;
  }
  if (strlen(value) != 3 || (value[2] != 'r' && value[2] != 'b')) {
    return false;
  }

  font_size = (uint8_t)atoi(value);
  if (!prv_valid_font_size(font_size)) {
    return false;
  }
  *font_size_out = font_size;
  *bold_out = value[2] == 'b';
  return true;
}

static bool prv_font_profile_matches(uint8_t font_size, bool bold) {
  return font_size == s_font_size && bold == s_bold_text;
}

static void prv_apply_font_profile(const char *value) {
  uint8_t font_size;
  bool bold;
  bool reader_active;
  uint8_t book;
  uint8_t chapter;
  uint8_t verse;

  if (!prv_parse_font_profile(value, &font_size, &bold) ||
      prv_font_profile_matches(font_size, bold)) {
    return;
  }

  reader_active = window_stack_get_top_window() == s_reader_window;
  book = s_current_book;
  chapter = s_current_chapter;
  verse = s_current_verse;

  prv_remove_queued_prefetch();
  s_prefetch_generation += 1;
  s_prefetch_in_flight = false;
  prv_cancel_page_request();
  prv_cache_clear();

  s_font_size = font_size;
  s_bold_text = bold;
  persist_write_int(BIBBLE_PERSIST_FONT_SIZE, s_font_size);
  persist_write_bool(BIBBLE_PERSIST_FONT_BOLD, s_bold_text);
  prv_relayout_for_font_profile();

  if (reader_active && book < BIBBLE_BOOK_COUNT && chapter >= 1 &&
      chapter <= prv_chapter_count(book)) {
    s_reader_text[0] = '\0';
    s_reader_loading = true;
    prv_update_reader_layers(true);
    prv_set_reader_header_label("Loading");
    prv_schedule_page_request(book, chapter, verse, 0);
  }
}

static void prv_reader_window_unload(Window *window) {
  (void)window;
  s_prefetch_generation += 1;
  s_prefetch_in_flight = false;
  prv_cancel_page_request();
  text_layer_destroy(s_reader_body_layer);
  scroll_layer_destroy(s_reader_scroll_layer);
  prv_destroy_header(&s_reader_header_layer, &s_reader_reference_layer, &s_reader_time_layer);
  s_reader_body_layer = NULL;
  s_reader_scroll_layer = NULL;
}

static void prv_reader_window_disappear(Window *window) {
  (void)window;
  s_prefetch_generation += 1;
  s_prefetch_in_flight = false;
  prv_cancel_page_request();
}

static void prv_show_reader_window(uint8_t book, uint8_t chapter, uint8_t verse, bool request_page) {
  if (book >= BIBBLE_BOOK_COUNT || chapter < 1 || chapter > prv_chapter_count(book)) {
    return;
  }
  if (!verse) {
    verse = 1;
  }

  s_prefetch_generation += 1;
  s_prefetch_in_flight = false;
  prv_invalidate_page_request();

  s_current_book = book;
  s_current_chapter = chapter;
  s_current_verse = verse;
  s_current_page = 1;
  s_page_count = 1;
  prv_format_chapter_reference(s_current_reference, sizeof(s_current_reference), book, chapter);
  s_reader_text[0] = '\0';
  s_reader_loading = request_page;

  if (!s_reader_window) {
    s_reader_window = window_create();
    window_set_window_handlers(s_reader_window, (WindowHandlers){
      .load = prv_reader_window_load,
      .disappear = prv_reader_window_disappear,
      .unload = prv_reader_window_unload,
    });
  }

  if (window_stack_get_top_window() != s_reader_window) {
    window_stack_push(s_reader_window, true);
  } else {
    prv_update_reader_layers(true);
  }

  if (request_page) {
    prv_schedule_page_request(book, chapter, verse, 0);
  } else {
    s_reader_loading = true;
    prv_update_reader_layers(true);
  }
}

static int prv_clamp_reader_offset(int offset_y) {
  Layer *scroll_layer;
  GRect bounds;
  GSize content_size;
  int min_y;

  if (!s_reader_scroll_layer) {
    return offset_y;
  }

  scroll_layer = scroll_layer_get_layer(s_reader_scroll_layer);
  bounds = layer_get_bounds(scroll_layer);
  content_size = scroll_layer_get_content_size(s_reader_scroll_layer);
  min_y = bounds.size.h - content_size.h;
  if (min_y > 0) {
    min_y = 0;
  }
  if (offset_y > 0) {
    return 0;
  }
  if (offset_y < min_y) {
    return min_y;
  }
  return offset_y;
}

static void prv_scroll_reader_by(int dy) {
  Layer *scroll_layer;
  GRect bounds;
  GSize content_size;
  GPoint offset;
  int min_y;
  int next_y;

  if (!s_reader_scroll_layer || s_reader_loading) {
    return;
  }

  scroll_layer = scroll_layer_get_layer(s_reader_scroll_layer);
  bounds = layer_get_bounds(scroll_layer);
  content_size = scroll_layer_get_content_size(s_reader_scroll_layer);
  min_y = bounds.size.h - content_size.h;
  if (min_y > 0) {
    min_y = 0;
  }

  offset = scroll_layer_get_content_offset(s_reader_scroll_layer);
  next_y = offset.y + dy;
  if (next_y > 0) {
    next_y = 0;
    if (dy > 0) {
      prv_request_previous_page();
      return;
    }
  } else if (next_y < min_y) {
    next_y = min_y;
    if (dy < 0) {
      prv_request_next_page();
      return;
    }
  }

  scroll_layer_set_content_offset(s_reader_scroll_layer, GPoint(0, prv_clamp_reader_offset(next_y)), false);
}

static void prv_reader_up_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  prv_scroll_reader_by(42);
}

static void prv_reader_down_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  prv_scroll_reader_by(-42);
}

static void prv_select_hold_timer_callback(void *context) {
  (void)context;
  s_select_hold_timer = NULL;
  s_select_hold_fired = true;
  prv_start_dictation();
}

static void prv_select_raw_down_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;

  if (s_select_hold_timer) {
    app_timer_cancel(s_select_hold_timer);
  }
  s_select_hold_fired = false;
  s_select_hold_timer = app_timer_register(BIBBLE_SELECT_HOLD_MS, prv_select_hold_timer_callback, NULL);
}

static void prv_grid_select_current(BibbleGridKind kind) {
  uint16_t selected = prv_grid_selected_index(kind);

  if (selected >= prv_grid_item_count(kind)) {
    return;
  }

  switch (kind) {
    case BibbleGridKindBook:
      prv_show_chapter_window((uint8_t)selected, 1);
      break;
    case BibbleGridKindChapter:
      prv_show_verse_window(s_selected_book, (uint8_t)(selected + 1), 1);
      break;
    case BibbleGridKindVerse:
      prv_show_reader_window(s_selected_book, s_selected_chapter, (uint8_t)(selected + 1), true);
      break;
    default:
      break;
  }
}

static void prv_grid_move_selection(BibbleGridKind kind, int delta, bool animated) {
  Layer *grid_layer = prv_grid_content_layer(kind);
  uint16_t count = prv_grid_item_count(kind);
  uint16_t selected = prv_grid_selected_index(kind);
  int next;

  if (!count) {
    return;
  }

  next = (int)selected + delta;
  if (next < 0) {
    next = 0;
  } else if (next >= count) {
    next = count - 1;
  }
  if ((uint16_t)next == selected) {
    return;
  }

  prv_grid_set_selected_index(kind, (uint16_t)next);
  if (grid_layer) {
    layer_mark_dirty(grid_layer);
  }
  prv_grid_ensure_selected_visible(kind, animated);
}

static void prv_select_raw_up_handler(ClickRecognizerRef recognizer, void *context) {
  BibbleGridKind kind;

  (void)recognizer;
  (void)context;

  if (s_select_hold_timer) {
    app_timer_cancel(s_select_hold_timer);
    s_select_hold_timer = NULL;
  }
  if (s_select_hold_fired) {
    return;
  }

  kind = prv_active_grid();
  prv_grid_select_current(kind);
}

static void prv_grid_up_handler(ClickRecognizerRef recognizer, void *context) {
  BibbleGridKind kind;

  (void)recognizer;
  (void)context;

  kind = prv_active_grid();
  prv_grid_move_selection(kind, -1, true);
}

static void prv_grid_down_handler(ClickRecognizerRef recognizer, void *context) {
  BibbleGridKind kind;

  (void)recognizer;
  (void)context;

  kind = prv_active_grid();
  prv_grid_move_selection(kind, 1, true);
}

static void prv_grid_click_config_provider(void *context) {
  (void)context;
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 150, prv_grid_up_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 150, prv_grid_down_handler);
  window_raw_click_subscribe(BUTTON_ID_SELECT, prv_select_raw_down_handler, prv_select_raw_up_handler, NULL);
}

static void prv_reader_click_config_provider(void *context) {
  (void)context;
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 150, prv_reader_up_handler);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 150, prv_reader_down_handler);
  window_raw_click_subscribe(BUTTON_ID_SELECT, prv_select_raw_down_handler, prv_select_raw_up_handler, NULL);
}

#if defined(PBL_MICROPHONE)
static const char *prv_dictation_status_text(DictationSessionStatus status) {
  switch (status) {
    case DictationSessionStatusFailureTranscriptionRejected:
      return "Dictation canceled";
    case DictationSessionStatusFailureNoSpeechDetected:
      return "No speech detected";
    case DictationSessionStatusFailureConnectivityError:
      return "Voice connection failed";
    case DictationSessionStatusFailureDisabled:
      return "Voice disabled";
    default:
      return "Voice input failed";
  }
}

static void prv_dictation_callback(DictationSession *session, DictationSessionStatus status, char *transcription,
                                   void *context) {
  char clean_text[BIBBLE_DICTATION_LENGTH];

  (void)session;
  (void)context;

  if (status != DictationSessionStatusSuccess || !transcription || !transcription[0]) {
    prv_set_status(prv_dictation_status_text(status));
    prv_set_reader_header_label(s_status);
    return;
  }

  prv_copy_payload_field(clean_text, sizeof(clean_text), transcription);
  prv_set_status(clean_text);
  prv_set_reader_header_label("Parsing");
  prv_send_message(BIBBLE_MSG_DICTATION_LOOKUP, clean_text);
}
#endif

static void prv_start_dictation(void) {
#if defined(PBL_MICROPHONE)
  if (!s_dictation_session) {
    prv_set_status("Voice unavailable");
    prv_set_reader_header_label(s_status);
    return;
  }
  prv_set_status("Listening");
  prv_set_reader_header_label("Listening");
  if (dictation_session_start(s_dictation_session) != DictationSessionStatusSuccess) {
    prv_set_status("Voice unavailable");
    prv_set_reader_header_label(s_status);
  }
#else
  prv_set_status("No microphone");
  prv_set_reader_header_label(s_status);
#endif
}

static void prv_handle_page(const char *payload) {
  char buffer[BIBBLE_PAYLOAD_LENGTH];
  char *cursor = buffer;
  BibbleCachedPage *entry;
  uint16_t generation;
  uint8_t response_font_size;
  bool response_bold;
  uint8_t book;
  uint8_t chapter;
  uint8_t verse;
  uint16_t page;
  uint16_t page_count;
  const char *text;
  bool should_apply;

  prv_copy_string(buffer, sizeof(buffer), payload);
  generation = (uint16_t)atoi(prv_next_field(&cursor));
  if (!prv_parse_font_profile(prv_next_field(&cursor), &response_font_size, &response_bold) ||
      !prv_font_profile_matches(response_font_size, response_bold)) {
    return;
  }
  book = (uint8_t)atoi(prv_next_field(&cursor));
  chapter = (uint8_t)atoi(prv_next_field(&cursor));
  verse = (uint8_t)atoi(prv_next_field(&cursor));
  page = (uint16_t)atoi(prv_next_field(&cursor));
  page_count = (uint16_t)atoi(prv_next_field(&cursor));
  text = prv_next_field(&cursor);

  if (book >= BIBBLE_BOOK_COUNT || chapter < 1 || chapter > prv_chapter_count(book)) {
    return;
  }
  should_apply = window_stack_get_top_window() == s_reader_window && s_reader_loading;
  if (generation) {
    should_apply = should_apply && generation == s_page_request_generation;
  } else {
    should_apply = should_apply && book == s_current_book && chapter == s_current_chapter &&
                   verse == s_current_verse;
  }
  if (!should_apply) {
    return;
  }
  entry = prv_cache_store(book, chapter, verse, page, page_count, text);
  prv_cancel_page_response_timer();
  prv_apply_cached_page(entry);
}

static void prv_handle_prefetch_page(const char *payload) {
  char buffer[BIBBLE_PAYLOAD_LENGTH];
  char *cursor = buffer;
  BibbleCachedPage *entry;
  BibblePageCursor *prefetch_cursor;
  uint16_t generation;
  uint8_t response_font_size;
  bool response_bold;
  uint8_t book;
  uint8_t chapter;
  uint8_t verse;
  uint16_t page;
  uint16_t page_count;
  const char *text;

  prv_copy_string(buffer, sizeof(buffer), payload);
  generation = (uint16_t)atoi(prv_next_field(&cursor));
  if (!prv_parse_font_profile(prv_next_field(&cursor), &response_font_size, &response_bold) ||
      !prv_font_profile_matches(response_font_size, response_bold)) {
    return;
  }
  book = (uint8_t)atoi(prv_next_field(&cursor));
  chapter = (uint8_t)atoi(prv_next_field(&cursor));
  verse = (uint8_t)atoi(prv_next_field(&cursor));
  page = (uint16_t)atoi(prv_next_field(&cursor));
  page_count = (uint16_t)atoi(prv_next_field(&cursor));
  text = prv_next_field(&cursor);

  if (book >= BIBBLE_BOOK_COUNT || chapter < 1 || chapter > prv_chapter_count(book)) {
    return;
  }

  if (generation != s_prefetch_generation || !s_prefetch_in_flight ||
      s_prefetch_step >= BIBBLE_PREFETCH_STEP_COUNT) {
    return;
  }

  entry = prv_cache_store(book, chapter, verse, page, page_count, text);
  if (!entry) {
    return;
  }

  prefetch_cursor = s_prefetch_direction > 0 ? &s_prefetch_forward_cursor : &s_prefetch_backward_cursor;
  prv_set_cursor_from_page(prefetch_cursor, entry);
  s_prefetch_in_flight = false;
  s_prefetch_step += 1;
  prv_continue_prefetch();
}

static void prv_handle_navigate(const char *payload) {
  char buffer[BIBBLE_PAYLOAD_LENGTH];
  char *cursor = buffer;
  uint8_t book;
  uint8_t chapter;
  uint8_t verse;
  const char *reference;

  prv_copy_string(buffer, sizeof(buffer), payload);
  book = (uint8_t)atoi(prv_next_field(&cursor));
  chapter = (uint8_t)atoi(prv_next_field(&cursor));
  verse = (uint8_t)atoi(prv_next_field(&cursor));
  reference = prv_next_field(&cursor);

  if (book >= BIBBLE_BOOK_COUNT) {
    return;
  }
  prv_set_status(reference && reference[0] ? reference : BIBBLE_BOOK_NAMES[book]);

  if (!chapter) {
    prv_show_chapter_window(book, 1);
    return;
  }

  prv_show_reader_window(book, chapter, verse ? verse : 1, false);
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *type_tuple = dict_find(iter, MESSAGE_KEY_MessageType);
  Tuple *payload_tuple = dict_find(iter, MESSAGE_KEY_Payload);
  const char *type = type_tuple ? type_tuple->value->cstring : "";
  const char *payload = payload_tuple ? payload_tuple->value->cstring : "";

  (void)context;

  if (strcmp(type, BIBBLE_MSG_STATUS) == 0) {
    if (payload[0] && strcmp(payload, "Select a book") != 0) {
      prv_set_status(payload);
    } else {
      prv_update_status_layers();
    }
  } else if (strcmp(type, BIBBLE_MSG_PAGE) == 0) {
    prv_handle_page(payload);
  } else if (strcmp(type, BIBBLE_MSG_PREFETCH_PAGE) == 0) {
    prv_handle_prefetch_page(payload);
  } else if (strcmp(type, BIBBLE_MSG_SETTINGS) == 0) {
    prv_apply_font_profile(payload);
  } else if (strcmp(type, BIBBLE_MSG_NAVIGATE) == 0) {
    prv_handle_navigate(payload);
  } else if (strcmp(type, BIBBLE_MSG_ERROR) == 0) {
    prv_cancel_page_response_timer();
    s_reader_loading = false;
    prv_set_status(payload[0] ? payload : "Error");
    prv_set_reader_header_label(s_status);
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  (void)reason;
  (void)context;
  prv_cancel_page_response_timer();
  s_reader_loading = false;
  prv_set_status("Phone message dropped");
  prv_set_reader_header_label(s_status);
}

static void prv_outbox_sent(DictionaryIterator *iter, void *context) {
  (void)iter;
  (void)context;
  prv_finish_outbox_message(true);
}

static void prv_outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  (void)iter;
  (void)reason;
  (void)context;
  prv_finish_outbox_message(false);
}

static BibbleGridKind prv_active_grid(void) {
  Window *top = window_stack_get_top_window();
  if (top == s_verse_window) {
    return BibbleGridKindVerse;
  }
  if (top == s_chapter_window) {
    return BibbleGridKindChapter;
  }
  if (top == s_book_window) {
    return BibbleGridKindBook;
  }
  return BibbleGridKindNone;
}

static void prv_scroll_grid_by(BibbleGridKind kind, int dy) {
  ScrollLayer *scroll_layer = prv_grid_scroll_layer(kind);
  GPoint offset;
  int next_y;

  if (!scroll_layer) {
    return;
  }

  offset = scroll_layer_get_content_offset(scroll_layer);
  next_y = prv_clamp_grid_offset(kind, offset.y + dy);
  scroll_layer_set_content_offset(scroll_layer, GPoint(0, next_y), false);
}

static bool prv_grid_index_from_touch(BibbleGridKind kind, int x, int y, uint16_t *index_out) {
  ScrollLayer *scroll_layer = prv_grid_scroll_layer(kind);
  Layer *scroll_root;
  GRect frame;
  GRect bounds;
  GPoint offset;
  GPoint point = GPoint(x, y);
  int content_x;
  int content_y;
  int col;
  int row;
  uint16_t index;

  if (!scroll_layer || !index_out) {
    return false;
  }

  scroll_root = scroll_layer_get_layer(scroll_layer);
  frame = layer_get_frame(scroll_root);
  bounds = layer_get_bounds(scroll_root);
  if (!grect_contains_point(&frame, &point)) {
    return false;
  }

  offset = scroll_layer_get_content_offset(scroll_layer);
  content_x = x - frame.origin.x;
  content_y = y - frame.origin.y - offset.y;
  if (content_x < 0 || content_x >= bounds.size.w || content_y < 0) {
    return false;
  }

  col = (content_x * BIBBLE_GRID_COLUMNS) / bounds.size.w;
  row = content_y / prv_grid_cell_height();
  index = (uint16_t)(row * BIBBLE_GRID_COLUMNS + col);
  if (index >= prv_grid_item_count(kind)) {
    return false;
  }

  *index_out = index;
  return true;
}

static void prv_handle_grid_touch_tap(BibbleGridKind kind, int x, int y) {
  Layer *grid_layer = prv_grid_content_layer(kind);
  uint16_t index;

  if (!prv_grid_index_from_touch(kind, x, y, &index)) {
    return;
  }

  prv_grid_set_selected_index(kind, index);
  if (grid_layer) {
    layer_mark_dirty(grid_layer);
  }
  prv_grid_select_current(kind);
}

static void prv_touch_handler(const TouchEvent *event, void *context) {
  int dx;
  int dy;
  BibbleGridKind grid_kind;
  bool reader_active;

  (void)context;

  if (!event) {
    return;
  }

  reader_active = window_stack_get_top_window() == s_reader_window && s_reader_scroll_layer;
  grid_kind = reader_active ? BibbleGridKindNone : prv_active_grid();

  switch (event->type) {
    case TouchEvent_Touchdown:
      s_touch_down = true;
      s_touch_dragged = false;
      s_touch_down_x = event->x;
      s_touch_down_y = event->y;
      s_touch_last_y = event->y;
      break;

    case TouchEvent_PositionUpdate:
      if (!s_touch_down) {
        break;
      }
      if (prv_iabs(event->x - s_touch_down_x) > BIBBLE_TOUCH_TAP_MAX_PX ||
          prv_iabs(event->y - s_touch_down_y) > BIBBLE_TOUCH_TAP_MAX_PX) {
        s_touch_dragged = true;
      }
      if (reader_active) {
        dy = event->y - s_touch_last_y;
        if (dy != 0) {
          prv_scroll_reader_by(dy);
        }
      } else if (grid_kind != BibbleGridKindNone) {
        dy = event->y - s_touch_last_y;
        if (dy != 0) {
          prv_scroll_grid_by(grid_kind, dy);
        }
      }
      s_touch_last_y = event->y;
      break;

    case TouchEvent_Liftoff:
      if (!s_touch_down) {
        break;
      }
      s_touch_down = false;
      dx = event->x - s_touch_down_x;
      dy = event->y - s_touch_down_y;

      if (reader_active) {
        if (prv_iabs(dx) > BIBBLE_TOUCH_SWIPE_MIN_PX && prv_iabs(dx) > prv_iabs(dy) && dx > 0) {
          window_stack_pop(true);
        } else if (!s_touch_dragged && prv_iabs(dy) > BIBBLE_TOUCH_SWIPE_MIN_PX) {
          prv_scroll_reader_by(dy);
        }
        break;
      }

      if (grid_kind == BibbleGridKindNone) {
        break;
      }
      if (prv_iabs(dx) < BIBBLE_TOUCH_TAP_MAX_PX && prv_iabs(dy) < BIBBLE_TOUCH_TAP_MAX_PX) {
        prv_handle_grid_touch_tap(grid_kind, s_touch_down_x, s_touch_down_y);
      } else if (!s_touch_dragged && prv_iabs(dy) > BIBBLE_TOUCH_SWIPE_MIN_PX && prv_iabs(dy) > prv_iabs(dx)) {
        prv_grid_move_selection(grid_kind, dy > 0 ? -1 : 1, true);
      }
      break;

    default:
      break;
  }
}

static void prv_init(void) {
  bool has_legacy_text_size = persist_exists(BIBBLE_PERSIST_LEGACY_LARGE_TEXT);
  bool legacy_large_text = has_legacy_text_size &&
                           persist_read_bool(BIBBLE_PERSIST_LEGACY_LARGE_TEXT);
  int32_t persisted_font_size = persist_exists(BIBBLE_PERSIST_FONT_SIZE)
    ? persist_read_int(BIBBLE_PERSIST_FONT_SIZE)
    : 0;

  s_font_size = prv_valid_font_size((uint8_t)persisted_font_size)
    ? (uint8_t)persisted_font_size
    : (has_legacy_text_size ? (legacy_large_text ? 18 : 14) : 18);
  s_bold_text = persist_exists(BIBBLE_PERSIST_FONT_BOLD)
    ? persist_read_bool(BIBBLE_PERSIST_FONT_BOLD)
    : (has_legacy_text_size ? legacy_large_text : true);
  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  app_message_register_outbox_sent(prv_outbox_sent);
  app_message_register_outbox_failed(prv_outbox_failed);
  app_message_open(640, 256);
  tick_timer_service_subscribe(MINUTE_UNIT, prv_minute_tick_handler);

#if defined(PBL_MICROPHONE)
  s_dictation_session = dictation_session_create(BIBBLE_DICTATION_LENGTH, prv_dictation_callback, NULL);
  if (s_dictation_session) {
    dictation_session_enable_confirmation(s_dictation_session, false);
  }
#endif

  s_book_window = window_create();
  window_set_window_handlers(s_book_window, (WindowHandlers){
    .load = prv_book_window_load,
    .appear = prv_book_window_appear,
    .unload = prv_book_window_unload,
  });
  window_stack_push(s_book_window, true);

  s_ready_timer = app_timer_register(BIBBLE_READY_DELAY_MS, prv_ready_timer_callback, NULL);
}

static void prv_deinit(void) {
  tick_timer_service_unsubscribe();
  if (s_ready_timer) {
    app_timer_cancel(s_ready_timer);
    s_ready_timer = NULL;
  }
  if (s_page_request_timer) {
    app_timer_cancel(s_page_request_timer);
    s_page_request_timer = NULL;
  }
  if (s_select_hold_timer) {
    app_timer_cancel(s_select_hold_timer);
    s_select_hold_timer = NULL;
  }
  if (s_outbox_retry_timer) {
    app_timer_cancel(s_outbox_retry_timer);
    s_outbox_retry_timer = NULL;
  }
  prv_cancel_page_response_timer();
  if (s_reader_window) {
    window_destroy(s_reader_window);
    s_reader_window = NULL;
  }
  if (s_verse_window) {
    window_destroy(s_verse_window);
    s_verse_window = NULL;
  }
  if (s_chapter_window) {
    window_destroy(s_chapter_window);
    s_chapter_window = NULL;
  }
#if defined(PBL_MICROPHONE)
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
    s_dictation_session = NULL;
  }
#endif
  if (s_book_window) {
    window_destroy(s_book_window);
    s_book_window = NULL;
  }
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
