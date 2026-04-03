def fetch_records(data, filter_on, uuid_col, ids, allowed_values=None, mask=None):

    records = data[~data[uuid_col].isin(ids)]

    if mask is not None:
        records = records[mask.loc[records.index]]

    if allowed_values:
        for col, vals in allowed_values.items():
            records = records[records[col].isin(vals)]

    counts = (
        records.groupby(filter_on)
        .size()
        .reset_index(name="count")
    )

    return counts, records


def sample_nd(df, cols, quota, random_state=42):
    q = quota if isinstance(quota, dict) else {k: None for k in quota}

    sub = df[df[cols].apply(tuple, axis=1).isin(q)]

    if all(v is None for v in q.values()):
        return sub.reset_index(drop=True)

    return sub.groupby(cols).apply(
        lambda x: x if q.get(x.name) is None else x.sample(min(len(x), q[x.name]), random_state),
        include_groups=False).reset_index(drop=True)