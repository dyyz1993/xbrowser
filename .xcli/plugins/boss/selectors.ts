export type JobDetailData = {
  jobTitle: string;
  salary: string;
  company: string;
  location: string;
  experience: string;
  education: string;
  description: string;
};

export type CompanyData = {
  rank: number;
  name: string;
  industry: string;
  funding: string;
  size: string;
  hotJob: string;
  href: string;
};

export type RecommendData = {
  viewers: Array<{
    name: string;
    company: string;
    title: string;
    salary: string;
  }>;
  profile: {
    name: string;
    experience: string;
    status: string;
    expectation: string;
  } | null;
};

export type ChatData = {
  sender: string;
  company: string;
  role: string;
  time: string;
  preview: string;
};

export type ResumeData = {
  name: string;
  experience: string;
  education: string;
  phone: string;
  email: string;
  advantage: string;
  status: string;
};

export type ParsedResumeContact = Pick<ResumeData, 'phone' | 'email'>;

export function textOf(element: Element | null | undefined): string {
  return element?.textContent?.trim() ?? '';
}

export function parseJobDetailTarget(input: string): string {
  const value = input.trim();
  const tokenPattern = /^[A-Za-z0-9_-]{18,}$/;
  const parseBossUrl = (raw: string): URL | null => {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.hostname !== 'www.zhipin.com' && parsed.hostname !== 'zhipin.com') return null;
    if (!/^\/job_detail\/[A-Za-z0-9_-]{18,}\.html$/.test(parsed.pathname)) return null;
    return parsed;
  };

  if (/^https?:\/\//i.test(value)) {
    const parsed = parseBossUrl(value);
    if (!parsed) throw new Error('职位详情 URL 不是 Boss 直聘 job_detail 地址');
    return parsed.toString();
  }

  if (value.startsWith('/')) {
    const parsed = parseBossUrl(`https://www.zhipin.com${value}`);
    if (!parsed) throw new Error('职位详情路径不是 Boss 直聘 job_detail 地址');
    return parsed.toString();
  }

  const token = value
    .replace(/\.html$/i, '');
  if (value.includes('/') || value.includes('?') || !tokenPattern.test(token)) {
    throw new Error(`无效的职位详情标识：${value}`);
  }
  return `https://www.zhipin.com/job_detail/${token}.html`;
}

export function extractJobDetail(): JobDetailData {
  const root = document.querySelector('.job-primary') ?? document;
  const q = (selector: string): Element | null => root.querySelector(selector);
  const detailSection = [
    ...document.querySelectorAll('.job-detail-section, .job-sec'),
  ]
    .map((element) => element.querySelector('.job-sec-text') ?? element)
    .find((element): element is Element =>
      Boolean(
        element?.textContent?.includes('岗位职责') ||
        element?.textContent?.includes('任职要求'),
      ),
    );
  return {
    jobTitle: textOf(q('.name h1') ?? q('.name .job-title') ?? q('h1')),
    salary: textOf(q('.name .salary') ?? q('.name .badge') ?? q('.salary')),
    company: textOf(
      document.querySelector('.sider-company .company-info a[title]') ??
        document.querySelector('.company-info a[title]') ??
        q('.company a[title]') ??
        q('.company'),
    ),
    location: textOf(q('.text-city') ?? q('.location')),
    experience: textOf(q('.text-experiece') ?? q('.text-experience')),
    education: textOf(q('.text-degree')),
    description: textOf(
      detailSection ?? document.querySelector('.job-sec-text'),
    ),
  };
}

export function extractCompanies(limit: number): CompanyData[] {
  const items = [
    ...document.querySelectorAll('.company-tab-box.company-list .sub-li'),
  ].slice(0, limit);
  return items
    .map((element, index) => {
      const company = element.querySelector('a.company-info');
      const job = element.querySelector('a.about-info p');
      const metadata = [
        ...company?.querySelectorAll('.conpany-text span') ?? [],
      ]
        .map(textOf)
        .filter(Boolean);
      const funding = metadata.find(value => /融资/.test(value)) ?? '';
      const industry = metadata.filter(value => value !== funding).join('');
      const size = textOf(company?.querySelector('.company-size, .size'));
      const jobText = job?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const hotJob = jobText.replace(/^热招\s*/, '').trim();
      return {
        rank: index + 1,
        name: textOf(company?.querySelector('h4')),
        industry,
        funding,
        size,
        hotJob,
        href: company?.getAttribute('href') ?? '',
      };
    })
    .filter((item) => item.name.length > 0);
}

export function extractRecommend(): RecommendData {
  const root = [...document.querySelectorAll('.sider-recommend-wrap')].find(
    (element) => /谁看过我|对我感兴趣/.test(element.textContent ?? ''),
  );
  const viewers = [...(root?.querySelectorAll('li.item-recommend') ?? [])]
    .slice(0, 10)
    .map((element) => ({
      name: textOf(element.querySelector('.name')),
      company: textOf(element.querySelector('.company')),
      title: textOf(element.querySelector('.detail')),
      salary: textOf(element.querySelector('.salary')),
    }))
    .filter((viewer) => viewer.name.length > 0);
  const profileName = [...document.querySelectorAll(
    'li.nav-figure .label-text, .user-info .label-text, .user-info .user-name, .user-info .name',
  )]
    .map(textOf)
    .find((value) => value.length > 0 && value !== '消息' && value !== '简历');
  return {
    viewers,
    profile: profileName
      ? {
          name: profileName,
          experience: '',
          status: '',
          expectation: '',
        }
      : null,
  };
}

export function extractChats(limit: number): ChatData[] {
  return [...document.querySelectorAll('.friend-content')]
    .slice(0, limit)
    .map((element) => {
      const lines = ((element as HTMLElement).innerText ?? '')
        .split('\n')
        .map((value: string) => value.trim())
        .filter(Boolean);
      const sender = textOf(element.querySelector('.name-text'));
      const metadata = [
        ...element.querySelectorAll('.name-box > span:not(.name-text)'),
      ]
        .map(textOf)
        .filter(Boolean);
      const company = metadata[0] ?? '';
      const role = metadata.slice(1).join('') ?? '';
      const time = textOf(element.querySelector('.time'));
      const preview =
        element
          .querySelector('.last-msg')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim() ??
        lines[2] ??
        '';
      return { sender, company, role, time, preview };
    })
    .filter((item) => item.sender.length > 0);
}

export function parseResumeContact(input: string): ParsedResumeContact {
  const flat = input.replace(/\s+/g, '');
  const phoneIndex = flat.search(/\d{3}\*{2,}\d*/);
  const contactBlob = phoneIndex >= 0
    ? flat.slice(phoneIndex).split('个人优势')[0]
    : '';
  const phone = contactBlob.match(/^\d{3}\*{2,}\d*/)?.[0] ?? '';
  const finalAt = contactBlob.lastIndexOf('@');
  const domain = finalAt >= 0
    ? contactBlob.slice(finalAt + 1).match(/^[\w-]+(?:\.[\w-]+)+/)?.[0]
    : undefined;
  const localCandidate = finalAt >= 0
    ? contactBlob.slice(0, finalAt).match(/[\w.+-]*\*{2,}[\w.+-]*$/)?.[0]
    : undefined;
  // Phone and email local text are visually adjacent but directly concatenated
  // in innerText. Email masking starts after the phone-like prefix.
  const maskStart = localCandidate?.search(/[a-z][\w.+-]*\*/i) ?? -1;
  const local = maskStart >= 0 ? localCandidate?.slice(maskStart) ?? '' : '';
  return { phone, email: local && domain ? `${local}@${domain}` : '' };
}

export function extractResume(): ResumeData {
  const text = document.body.innerText;
  const contact = parseResumeContact(text);
  const emailMatch = contact.email ? [contact.email] : undefined;
  const phoneMatch = contact.phone ? [contact.phone] : undefined;

  const experienceLine =
    text
      .split('\n')
      .map((value: string) => value.trim())
      .find((value: string) => /\d+年经验/.test(value)) ?? '';
  const advantage =
    text
      .match(
        /个人优势\n([\s\S]{10,500}?)(?=\n期望职位|\n工作经历|\n项目经历)/,
      )?.[1]
      ?.trim() ?? '';
  const educationMatch = text.match(
    /教育经历[\s\S]*?\n(本科|大专|硕士|博士|学历不限)\n专业技能/,
  );
  const education = educationMatch?.[1] ?? '';
  return {
    name:
      text
        .split('\n')
        .map((value: string) => value.trim())
        .find((value: string) => /先生$|女士$/.test(value)) ?? '',
    experience: experienceLine.replace(/离职-\S+|在职-\S+/, '').trim(),
    education,
    phone: phoneMatch?.[0] ?? '',
    email: emailMatch?.[0] ?? '',
    advantage,
    status: experienceLine.match(/(离职-\S+|在职-\S+)/)?.[1] ?? '',
  };
}
